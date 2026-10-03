import type { SQLInputValue, StatementSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Pool } from "pg";

export type Row = Record<string, unknown>;
export type Param = string | number | null | Uint8Array | undefined;

/**
 * Minimal async database interface shared by SQLite and Postgres.
 * SQL is written once with `?` placeholders and a portable subset of types (TEXT, INTEGER, BLOB/BYTEA).
 */
export interface Db {
  readonly dialect: "sqlite" | "postgres";
  run(sql: string, params?: Param[]): Promise<void>;
  all<T extends Row = Row>(sql: string, params?: Param[]): Promise<T[]>;
  get<T extends Row = Row>(sql: string, params?: Param[]): Promise<T | undefined>;
  /** Multi-statement script without parameters (DDL). */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------- SQLite (node:sqlite)

const STATEMENT_CACHE_SIZE = 256;

export function openSqlite(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  // Loaded on demand: `node:sqlite` prints an experimental warning on import, and Postgres mode never needs it.
  const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite") | undefined;
  if (!sqlite) throw new Error("SQLite needs Node.js 22.13 or later (node:sqlite). Upgrade Node, or set DFL_DATABASE_URL to use Postgres.");
  const raw = new sqlite.DatabaseSync(path);
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
  // Bounded LRU: queries built with a variable number of placeholders would otherwise grow this forever.
  const cache = new Map<string, StatementSync>();
  const stmt = (sql: string) => {
    let s = cache.get(sql);
    if (s) {
      cache.delete(sql);
    } else {
      s = raw.prepare(sql);
      if (cache.size >= STATEMENT_CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    }
    cache.set(sql, s);
    return s;
  };
  const args = (p?: Param[]) => (p ?? []).map((x) => (x === undefined ? null : x)) as SQLInputValue[];

  // One connection: operations outside a transaction wait for the running one.
  let chain: Promise<unknown> = Promise.resolve();
  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const direct: Omit<Db, "transaction" | "close"> = {
    dialect: "sqlite",
    async run(sql, p) {
      stmt(sql).run(...args(p));
    },
    async all(sql, p) {
      return stmt(sql).all(...args(p)) as never;
    },
    async get(sql, p) {
      return stmt(sql).get(...args(p)) as never;
    },
    async exec(sql) {
      raw.exec(sql);
    },
  };

  const db: Db = {
    ...direct,
    run: (sql, p) => locked(() => direct.run(sql, p)),
    all: (sql, p) => locked(() => direct.all(sql, p)) as never,
    get: (sql, p) => locked(() => direct.get(sql, p)) as never,
    exec: (sql) => locked(() => direct.exec(sql)),
    transaction: (fn) =>
      locked(async () => {
        raw.exec("BEGIN IMMEDIATE");
        try {
          const tx: Db = { ...direct, transaction: (f) => f(tx), close: async () => undefined };
          const out = await fn(tx);
          raw.exec("COMMIT");
          return out;
        } catch (e) {
          raw.exec("ROLLBACK");
          throw e;
        }
      }),
    async close() {
      await chain;
      raw.close();
    },
  };
  return db;
}

// ---------------------------------------------------------------- Postgres

export interface PgClientLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  /** Multi-statement script. Falls back to `query` (simple protocol) when absent. */
  exec?(sql: string): Promise<unknown>;
}
export interface PgLike extends PgClientLike {
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (c: PgClientLike) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function pgFromPool(pool: Pool): PgLike {
  return {
    query: (sql, params) => pool.query(sql, params as unknown[]),
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** `?` -> `$1, $2...` */
export function toPgSql(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

export function openPostgres(pg: PgLike): Db {
  const wrap = (c: PgClientLike): Pick<Db, "run" | "all" | "get"> => ({
    async run(sql, p) {
      await c.query(toPgSql(sql), p ?? []);
    },
    async all(sql, p) {
      return (await c.query(toPgSql(sql), p ?? [])).rows as never;
    },
    async get(sql, p) {
      return (await c.query(toPgSql(sql), p ?? [])).rows[0] as never;
    },
  });
  const db: Db = {
    dialect: "postgres",
    ...wrap(pg),
    exec: (sql) => pg.exec(sql),
    transaction: (fn) =>
      pg.transaction(async (c) => {
        const tx: Db = { dialect: "postgres", ...wrap(c), exec: async (s) => void (await (c.exec ? c.exec(s) : c.query(s))), transaction: (f) => f(tx), close: async () => undefined };
        return fn(tx);
      }),
    close: () => pg.close(),
  };
  return db;
}

// ---------------------------------------------------------------- migrations

export interface Migration {
  id: string;
  up(dialect: Db["dialect"]): string;
}

export async function migrate(db: Db, migrations: Migration[]): Promise<void> {
  await db.exec("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set((await db.all<{ id: string }>("SELECT id FROM _migrations")).map((r) => r.id));
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.up(db.dialect));
      await tx.run("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)", [m.id, new Date().toISOString()]);
    });
  }
}

// ---------------------------------------------------------------- vectors <-> BLOB

export function vecToBytes(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

export function bytesToVec(b: unknown): Float32Array {
  const u8 = b as Uint8Array;
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return new Float32Array(copy.buffer);
}
