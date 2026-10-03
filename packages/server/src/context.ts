import { parseEnv } from "./env.js";
import { assertWritable } from "./preflight.js";
import { mkdir, stat, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { createEmbedder, createLlm, type Llm } from "@defluance/ai";
import {
  IndexStore,
  JobQueue,
  backfillEmbeddings,
  indexVault,
  openPostgres,
  openSqlite,
  pgFromPool,
  type Db,
  type Handler,
} from "@defluance/indexer";
import type { Embedder } from "@defluance/shared";
import {
  defaultConfig,
  head,
  initRepo,
  loadConfig,
  loadSchema,
  CONFIG_PATH,
  SCHEMA_PATH,
  type Author,
  type Schema,
  type VaultConfig,
} from "@defluance/vault-core";
import type { GithubPort } from "./ports.js";
import { RateLimiter } from "./auth.js";
import { Collab } from "./collab.js";
import { KeyService, type KeyOptions } from "./keys.js";
import { PrivateIndex } from "./private-index.js";
import { SystemStore, type Role } from "./system.js";

export type Env = Record<string, string | undefined>;

/** Vectors computed in the background after the text is indexed (real models are slow). */
export interface EmbeddingProgress {
  running: boolean;
  done: number;
  total: number;
  error: string | null;
}

export interface Ctx {
  root: string;
  /** Progress of the background embedding. `running` is false when every passage has its vector. */
  embedding: EmbeddingProgress;
  /** Resolves when the running background embedding ends. Tests wait on it. */
  embeddingDone: Promise<void>;
  db: Db;
  store: IndexStore;
  sys: SystemStore;
  /** Keys of people and agents, and which are unlocked right now. */
  keys: KeyService;
  /** Decrypted notes of the unlocked keys. Memory only. */
  priv: PrivateIndex;
  /** Whether a language model may see private text when answering a question. Off unless DFL_PRIVATE_LLM=allow. */
  privateLlm: boolean;
  /** Live editing rooms. Attach it to the HTTP server to accept WebSocket connections. */
  collab: Collab;
  /** Files of the vault that did not load (the last good version, or the defaults, are in use). */
  problems: Problems;
  jobs: JobQueue;
  embedder: Embedder;
  llm: Llm | null;
  github: GithubPort | null;
  getConfig(): Promise<VaultConfig>;
  getSchema(): Promise<Schema>;
  /** Commit author for writes made by the server itself (derived status). */
  bot: Author;
  sessionSecret: string;
  admins: string[];
  defaultRole: Role | null;
  /** Local mode: no sign-in, the machine owner is admin. */
  localMode: boolean;
  oauth: { clientId: string; clientSecret: string } | null;
  publicUrl: string;
  allowedOrigins: string[];
  rateLimiter: RateLimiter;
  /** Static UI to serve, if built. */
  uiDir: string | null;
  fetch: typeof fetch;
  /** One structured log line. */
  log(entry: Record<string, unknown>): void;
  now(): Date;
  close(): Promise<void>;
}

export interface ContextOptions {
  root: string;
  dataDir?: string;
  env?: Env;
  embedder?: Embedder;
  llm?: Llm | null;
  github?: GithubPort | null;
  localMode?: boolean;
  uiDir?: string | null;
  fetch?: typeof fetch;
  /** Defaults to JSON lines on stdout. */
  log?: ((entry: Record<string, unknown>) => void) | false;
  now?: () => Date;
  keys?: KeyOptions;
}

/** What is wrong with the vault right now, by file. Empty when everything loads. */
export type Problems = { config: string | null; schema: string | null };

/**
 * Re-read a small file only when its mtime changes.
 * A file that does not parse must not take the server down or turn every request into a 500: the last good version stays
 * in use (the defaults, if there never was one) and the problem is reported through `onProblem` until the file is fixed.
 */
function cached<T>(path: string, load: () => Promise<T>, fallback: () => T, onProblem: (message: string | null) => void): () => Promise<T> {
  let at = -1;
  let value: T | undefined;
  return async () => {
    const m = await stat(path).then((s) => s.mtimeMs, () => 0);
    if (value === undefined || m !== at) {
      try {
        value = m === 0 ? fallback() : await load();
        onProblem(null);
      } catch (e) {
        value ??= fallback();
        onProblem(e instanceof Error ? e.message : String(e));
      }
      at = m;
    }
    return value;
  };
}

export async function createContext(opts: ContextOptions): Promise<Ctx> {
  const env = opts.env ?? process.env;
  const cfg = parseEnv(env);
  const root = opts.root;
  const dataDir = opts.dataDir ?? cfg.DFL_DATA_DIR ?? join(root, ".defluance", "data");
  await assertWritable(root, "the vault");
  if (!cfg.DFL_DATABASE_URL) await assertWritable(dataDir, "the data folder");
  if (!existsSync(join(root, ".git"))) await initRepo(root);

  let db: Db;
  const url = cfg.DFL_DATABASE_URL;
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
    // An idle client dropped by the server (restart, failover) emits "error"; unhandled, that kills the process.
    pool.on("error", (e) => (opts.log === false ? undefined : console.error(JSON.stringify({ t: new Date().toISOString(), msg: "pg-pool-error", error: e.message }))));
    db = openPostgres(pgFromPool(pool));
  } else {
    await mkdir(dataDir, { recursive: true });
    // Keep the database out of the vault's git history.
    const ignore = join(root, ".defluance", ".gitignore");
    if (!existsSync(ignore) && dataDir.startsWith(join(root, ".defluance"))) await writeFile(ignore, "data/\n");
    db = openSqlite(join(dataDir, "defluance.sqlite"));
  }
  const store = await IndexStore.open(db);
  const now = opts.now ?? (() => new Date());
  const sys = await SystemStore.open(db, now);
  const jobs = new JobQueue(db, now);
  const keyOptions = { bits: cfg.DFL_RSA_BITS, ...(opts.keys ?? {}) };
  const keys = new KeyService(sys, root, now, keyOptions);
  const priv = new PrivateIndex(store, root, async () => (await getSchema()).linkTypes);
  // Decrypted notes are dropped soon after their key stops being used, even if nobody locks it.
  const sweeper = setInterval(() => priv.sweep(keyOptions.idleMs ?? 30 * 60_000), 60_000);
  sweeper.unref();

  const secretFile = join(dataDir, "session-secret");
  let sessionSecret = cfg.DFL_SESSION_SECRET;
  if (!sessionSecret && !url) {
    try {
      sessionSecret = (await readFile(secretFile, "utf8")).trim();
    } catch {
      sessionSecret = crypto.randomUUID() + crypto.randomUUID();
      await writeFile(secretFile, sessionSecret, { mode: 0o600 });
    }
  }
  if (!sessionSecret) throw new Error("DFL_SESSION_SECRET is required when using Postgres");

  const publicUrl = cfg.DFL_PUBLIC_URL.replace(/\/$/, "");
  const defaultRole = cfg.DFL_DEFAULT_ROLE ?? null;

  const problems: Problems = { config: null, schema: null };
  const getSchema = cached(join(root, SCHEMA_PATH), () => loadSchema(root), () => structuredClone(defaultSchemaFallback), (m) => void (problems.schema = m && `.defluance/schema.yaml: ${m}`));

  const ctx: Ctx = {
    root,
    embedding: { running: false, done: 0, total: 0, error: null },
    embeddingDone: Promise.resolve(),
    db,
    store,
    sys,
    keys,
    priv,
    privateLlm: cfg.DFL_PRIVATE_LLM === "allow",
    collab: undefined as never,
    problems,
    jobs,
    embedder: opts.embedder ?? createEmbedder(env["DFL_EMBED"], { env }),
    llm: opts.llm !== undefined ? opts.llm : createLlm(env["DFL_LLM"], { env }),
    github: opts.github ?? null,
    getConfig: cached(join(root, CONFIG_PATH), () => loadConfig(root), () => structuredClone(defaultConfig), (m) => void (problems.config = m && `.defluance/config.yaml: ${m}`)),
    getSchema,
    bot: { name: "defluance-bot", email: "bot@defluance.local" },
    sessionSecret,
    admins: cfg.DFL_ADMINS,
    defaultRole,
    localMode: opts.localMode ?? false,
    oauth: cfg.GITHUB_OAUTH_CLIENT_ID && cfg.GITHUB_OAUTH_CLIENT_SECRET ? { clientId: cfg.GITHUB_OAUTH_CLIENT_ID, clientSecret: cfg.GITHUB_OAUTH_CLIENT_SECRET } : null,
    publicUrl,
    allowedOrigins: [publicUrl, ...cfg.DFL_ALLOWED_ORIGINS],
    rateLimiter: new RateLimiter(cfg.DFL_RATE_LIMIT),
    uiDir: opts.uiDir ?? null,
    fetch: opts.fetch ?? fetch,
    log: opts.log === false ? () => undefined : (opts.log ?? ((e) => console.log(JSON.stringify({ t: new Date().toISOString(), ...e })))),
    now,
    close: async () => {
      clearInterval(sweeper);
      await ctx.collab.close();
      priv.dropAll();
      await db.close();
    },
  };
  ctx.collab = new Collab(ctx);
  return ctx;
}

import { defaultSchema as defaultSchemaFallback } from "@defluance/vault-core";

// ---------------------------------------------------------------- indexing

export interface IndexPayload {
  paths?: string[];
}

/**
 * Compute the missing vectors without blocking anyone. One run at a time. A failure (model download, provider
 * outage) is recorded and retried a minute later: search keeps working by words in the meantime.
 */
export function startBackfill(ctx: Ctx): void {
  if (ctx.embedding.running || !ctx.embedder.slow) return;
  ctx.embedding = { running: true, done: 0, total: 0, error: null };
  ctx.embeddingDone = (async () => {
    try {
      await backfillEmbeddings(ctx.store, ctx.embedder, {
        onProgress: (p) => {
          ctx.embedding.done = p.done;
          ctx.embedding.total = p.total;
        },
      });
      ctx.embedding.error = null;
    } catch (e) {
      ctx.embedding.error = e instanceof Error ? e.message : String(e);
      ctx.log({ msg: "embedding failed", error: ctx.embedding.error });
      setTimeout(() => startBackfill(ctx), 60_000).unref();
    } finally {
      ctx.embedding.running = false;
    }
  })();
}

export async function indexNow(ctx: Ctx, paths?: string[]): Promise<void> {
  const config = await ctx.getConfig();
  const schema = await ctx.getSchema();
  const commit = await head(ctx.root).catch(() => null);
  await indexVault(ctx.store, {
    root: ctx.root,
    embedder: ctx.embedder,
    commit,
    config,
    linkTypes: schema.linkTypes,
    ...(paths ? { paths } : {}),
  });
  startBackfill(ctx);
}

export function jobHandlers(ctx: Ctx): Record<string, Handler> {
  return {
    ...(ctx.github?.handlers?.() ?? {}),
    "index.incremental": async (p) => indexNow(ctx, (p as IndexPayload).paths),
    "index.full": async () => indexNow(ctx),
  };
}

const mergePaths = (a: unknown, b: unknown): IndexPayload => ({
  paths: [...new Set([...((a as IndexPayload).paths ?? []), ...((b as IndexPayload).paths ?? [])])],
});

/** Queue an incremental index and run whatever is due, so a write is visible to the next read. */
export async function indexAfterWrite(ctx: Ctx, paths: string[]): Promise<void> {
  await ctx.jobs.enqueue("index.incremental", { paths }, { coalesce: mergePaths });
  await ctx.jobs.runDue(jobHandlers(ctx));
}
