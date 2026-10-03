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
}

/** Re-read a small file only when its mtime changes. */
function cached<T>(path: string, load: () => Promise<T>, fallback: () => T): () => Promise<T> {
  let at = -1;
  let value: T | undefined;
  return async () => {
    const m = await stat(path).then((s) => s.mtimeMs, () => 0);
    if (value === undefined || m !== at) {
      value = m === 0 ? fallback() : await load();
      at = m;
    }
    return value;
  };
}

export async function createContext(opts: ContextOptions): Promise<Ctx> {
  const env = opts.env ?? process.env;
  const root = opts.root;
  if (!existsSync(join(root, ".git"))) await initRepo(root);

  const dataDir = opts.dataDir ?? env["DFL_DATA_DIR"] ?? join(root, ".defluance", "data");
  let db: Db;
  const url = env["DFL_DATABASE_URL"];
  if (url) {
    db = openPostgres(pgFromPool(new pg.Pool({ connectionString: url })));
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

  const secretFile = join(dataDir, "session-secret");
  let sessionSecret = env["DFL_SESSION_SECRET"];
  if (!sessionSecret && !url) {
    try {
      sessionSecret = (await readFile(secretFile, "utf8")).trim();
    } catch {
      sessionSecret = crypto.randomUUID() + crypto.randomUUID();
      await writeFile(secretFile, sessionSecret, { mode: 0o600 });
    }
  }
  if (!sessionSecret) throw new Error("DFL_SESSION_SECRET is required when using Postgres");

  const publicUrl = (env["DFL_PUBLIC_URL"] ?? "http://localhost:4000").replace(/\/$/, "");
  const defaultRole = env["DFL_DEFAULT_ROLE"] === "reader" || env["DFL_DEFAULT_ROLE"] === "editor" ? env["DFL_DEFAULT_ROLE"] : null;

  return {
    root,
    embedding: { running: false, done: 0, total: 0, error: null },
    embeddingDone: Promise.resolve(),
    db,
    store,
    sys,
    jobs,
    embedder: opts.embedder ?? createEmbedder(env["DFL_EMBED"], { env }),
    llm: opts.llm !== undefined ? opts.llm : createLlm(env["DFL_LLM"], { env }),
    github: opts.github ?? null,
    getConfig: cached(join(root, CONFIG_PATH), () => loadConfig(root), () => structuredClone(defaultConfig)),
    getSchema: cached(join(root, SCHEMA_PATH), () => loadSchema(root), () => structuredClone(defaultSchemaFallback)),
    bot: { name: "defluance-bot", email: "bot@defluance.local" },
    sessionSecret,
    admins: (env["DFL_ADMINS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    defaultRole,
    localMode: opts.localMode ?? false,
    oauth: env["GITHUB_OAUTH_CLIENT_ID"] && env["GITHUB_OAUTH_CLIENT_SECRET"] ? { clientId: env["GITHUB_OAUTH_CLIENT_ID"], clientSecret: env["GITHUB_OAUTH_CLIENT_SECRET"] } : null,
    publicUrl,
    allowedOrigins: [publicUrl, ...(env["DFL_ALLOWED_ORIGINS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean)],
    rateLimiter: new RateLimiter(Number(env["DFL_RATE_LIMIT"] ?? 300)),
    uiDir: opts.uiDir ?? null,
    fetch: opts.fetch ?? fetch,
    log: opts.log === false ? () => undefined : (opts.log ?? ((e) => console.log(JSON.stringify({ t: new Date().toISOString(), ...e })))),
    now,
    close: () => db.close(),
  };
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
