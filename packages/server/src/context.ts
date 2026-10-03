import { mkdir, stat, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { createEmbedder, createLlm, type Llm } from "@defluance/ai";
import {
  IndexStore,
  JobQueue,
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

export interface Ctx {
  root: string;
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
    let m = 0;
    try {
      m = (await stat(path)).mtimeMs;
    } catch {
      m = 0;
    }
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

  const dataDir = opts.dataDir ?? join(root, ".defluance", "data");
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
}

export function jobHandlers(ctx: Ctx): Record<string, Handler> {
  return {
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
