import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { openPostgres, openSqlite, type Db, type PgLike } from "./db.js";
import { IndexStore } from "./store.js";

export function pgFromPglite(p: PGlite): PgLike {
  return {
    query: (sql, params) => p.query(sql, params as never[]),
    exec: async (sql) => void (await p.exec(sql)),
    transaction: (fn) => p.transaction((tx) => fn(tx as never)),
    close: () => p.close(),
  };
}

export const dialects = ["sqlite", "postgres"] as const;

export async function openTestDb(d: (typeof dialects)[number]): Promise<Db> {
  return d === "sqlite" ? openSqlite(":memory:") : openPostgres(pgFromPglite(new PGlite()));
}

export async function openTestStore(d: (typeof dialects)[number]): Promise<IndexStore> {
  return IndexStore.open(await openTestDb(d));
}

/** Wipe all data but keep the schema, so one database serves a whole test file. */
export async function resetStore(store: IndexStore): Promise<void> {
  for (const t of ["chunks", "edges", "notes", "gh_nodes", "embedding_cache", "meta", "jobs"]) await store.db.run(`DELETE FROM ${t}`);
}

export async function makeVault(files: Record<string, string>): Promise<{ root: string; write(p: string, c: string): Promise<void>; remove(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "dfl-idx-"));
  const write = async (p: string, c: string) => {
    await mkdir(dirname(join(root, p)), { recursive: true });
    await writeFile(join(root, p), c);
  };
  for (const [p, c] of Object.entries(files)) await write(p, c);
  return { root, write, remove: () => rm(root, { recursive: true, force: true }) };
}

export const note = (type: string, status: string, body: string, extra = "") =>
  `---\ntype: ${type}\nstatus: ${status}\nowner: ana\n${extra}---\n${body}\n`;
