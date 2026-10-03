import { bytesToVec, migrate, type Db, type Row } from "./db.js";
import { indexMigrations } from "./migrations.js";
import type { Heading } from "@defluance/vault-core";

export interface NoteRow {
  id: string;
  path: string;
  space: string;
  type: string | null;
  status: string | null;
  owner: string | null;
  title: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  headings: Heading[];
  content_hash: string;
  commit_sha: string | null;
  updated_at: string;
}

export interface EdgeRow {
  id: string;
  from_note: string;
  to_ref: string;
  heading: string | null;
  kind: "note" | "github";
  link_type: string;
  source: string;
  line: number;
  to_note: string | null;
}

export interface GhNode {
  key: string;
  kind: "issue" | "pull-request";
  state: "open" | "closed" | "merged";
  title: string;
  labels: string[];
  author: string | null;
  files: string[];
  merged_at: string | null;
  url: string | null;
  updated_at: string;
}

export interface GhFilter {
  /** Restrict to these `owner/repo` (case-insensitive). An empty list matches nothing. */
  repos?: string[] | undefined;
  kind?: GhNode["kind"] | undefined;
  state?: GhNode["state"] | undefined;
  /** `12` or `#12` matches that number first; any text matches title, labels, author or key (case-insensitive). */
  q?: string | undefined;
  limit?: number | undefined;
}

export interface NoteFilter {
  space?: string | undefined;
  /** Restrict to these spaces (permissions). */
  spaces?: string[] | undefined;
  type?: string | undefined;
  status?: string | undefined;
  tag?: string | undefined;
  owner?: string | undefined;
  /** Restrict to these note ids (scoped questions). */
  ids?: string[] | undefined;
}

const json = <T>(s: unknown, fallback: T): T => {
  try {
    return JSON.parse(String(s)) as T;
  } catch {
    return fallback;
  }
};

export function toNote(r: Row): NoteRow {
  return {
    id: r["id"] as string,
    path: r["path"] as string,
    space: r["space"] as string,
    type: (r["type"] as string | null) ?? null,
    status: (r["status"] as string | null) ?? null,
    owner: (r["owner"] as string | null) ?? null,
    title: r["title"] as string,
    tags: json<string[]>(r["tags"], []),
    frontmatter: json<Record<string, unknown>>(r["frontmatter"], {}),
    headings: json<Heading[]>(r["headings"], []),
    content_hash: r["content_hash"] as string,
    commit_sha: (r["commit_sha"] as string | null) ?? null,
    updated_at: r["updated_at"] as string,
  };
}

export function toGh(r: Row): GhNode {
  return {
    key: r["key"] as string,
    kind: r["kind"] as GhNode["kind"],
    state: r["state"] as GhNode["state"],
    title: r["title"] as string,
    labels: json<string[]>(r["labels"], []),
    author: (r["author"] as string | null) ?? null,
    files: json<string[]>(r["files"], []),
    merged_at: (r["merged_at"] as string | null) ?? null,
    url: (r["url"] as string | null) ?? null,
    updated_at: r["updated_at"] as string,
  };
}

/** WHERE fragment and params for a NoteFilter on table alias `n`. */
export function noteWhere(f: NoteFilter, alias = "n"): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (f.space) {
    parts.push(`${alias}.space = ?`);
    params.push(f.space);
  }
  if (f.spaces) {
    if (f.spaces.length === 0) parts.push("1 = 0");
    else {
      parts.push(`${alias}.space IN (${f.spaces.map(() => "?").join(", ")})`);
      params.push(...f.spaces);
    }
  }
  if (f.ids) {
    if (f.ids.length === 0) parts.push("1 = 0");
    else {
      parts.push(`${alias}.id IN (${f.ids.map(() => "?").join(", ")})`);
      params.push(...f.ids);
    }
  }
  for (const k of ["type", "status", "owner"] as const) {
    if (f[k]) {
      parts.push(`${alias}.${k} = ?`);
      params.push(f[k] as string);
    }
  }
  if (f.tag) {
    parts.push(`${alias}.tags LIKE ? ESCAPE '\\'`);
    params.push(`%${JSON.stringify(f.tag).replace(/[%_\\]/g, "\\$&")}%`);
  }
  return { sql: parts.length ? " AND " + parts.join(" AND ") : "", params };
}

export interface VectorItem {
  chunkId: string;
  noteId: string;
  vec: Float32Array;
}

export interface GraphData {
  nodes: Map<string, Pick<NoteRow, "id" | "title" | "type" | "status" | "space">>;
  edges: EdgeRow[];
  out: Map<string, EdgeRow[]>;
  in: Map<string, EdgeRow[]>;
}

export class IndexStore {
  private vecCache: { version: number; items: VectorItem[] } | undefined;
  private graphCache: { version: number; data: GraphData } | undefined;

  private constructor(readonly db: Db) {}

  static async open(db: Db): Promise<IndexStore> {
    await migrate(db, indexMigrations);
    return new IndexStore(db);
  }

  async getMeta(key: string): Promise<string | undefined> {
    return (await this.db.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", [key]))?.value;
  }

  async setMeta(key: string, value: string, db: Db = this.db): Promise<void> {
    await db.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [key, value]);
  }

  /** Bumped by every index run. Caches key on it. */
  async version(): Promise<number> {
    return Number((await this.getMeta("index_version")) ?? 0);
  }

  async bump(db: Db = this.db): Promise<void> {
    const v = Number((await db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'index_version'"))?.value ?? 0);
    await this.setMeta("index_version", String(v + 1), db);
  }

  async noteHashes(): Promise<Map<string, string>> {
    const rows = await this.db.all<{ id: string; content_hash: string }>("SELECT id, content_hash FROM notes");
    return new Map(rows.map((r) => [r.id, r.content_hash]));
  }

  async getNote(id: string): Promise<NoteRow | undefined> {
    const r = await this.db.get("SELECT * FROM notes WHERE id = ?", [id]);
    return r ? toNote(r) : undefined;
  }

  async allNotes(): Promise<NoteRow[]> {
    return (await this.db.all("SELECT * FROM notes ORDER BY id")).map(toNote);
  }

  async listNotes(f: NoteFilter & { limit?: number | undefined; after?: string | undefined; sort?: "id" | "updated" | undefined }): Promise<NoteRow[]> {
    const w = noteWhere(f);
    const order = f.sort === "updated" ? "n.updated_at DESC, n.id" : "n.id";
    const sql = `SELECT n.* FROM notes n WHERE 1 = 1${w.sql}${f.after ? " AND n.id > ?" : ""} ORDER BY ${order} LIMIT ?`;
    const params: (string | number)[] = [...w.params];
    if (f.after) params.push(f.after);
    params.push(f.limit ?? 50);
    return (await this.db.all(sql, params)).map(toNote);
  }

  /** Notes whose file is encrypted: only their public header is indexed. */
  async encryptedNotes(f: NoteFilter = {}): Promise<NoteRow[]> {
    const w = noteWhere(f);
    // A cheap pre-filter in SQL; the exact test is on the parsed header, since a plain note may mention the word.
    const rows = await this.db.all(`SELECT n.* FROM notes n WHERE n.frontmatter LIKE ?${w.sql} ORDER BY n.id`, ['%"encrypted"%', ...w.params]);
    return rows.map(toNote).filter((n) => typeof n.frontmatter["encrypted"] === "object" && n.frontmatter["encrypted"] !== null);
  }

  /** How many notes of each type are in each status, for the notes the filter lets through. */
  async stats(f: NoteFilter = {}): Promise<{ type: string | null; status: string | null; count: number }[]> {
    const w = noteWhere(f);
    const rows = await this.db.all<{ type: string | null; status: string | null; c: number | string }>(`SELECT n.type, n.status, COUNT(*) AS c FROM notes n WHERE 1 = 1${w.sql} GROUP BY n.type, n.status`, w.params);
    return rows.map((r) => ({ type: r.type, status: r.status, count: Number(r.c) }));
  }

  async counts(): Promise<{ notes: number; chunks: number; edges: number; embedded: number; pending: number }> {
    const one = async (sql: string) => Number((await this.db.get<{ c: number | string }>(sql))?.c ?? 0);
    return {
      notes: await one("SELECT COUNT(*) AS c FROM notes"),
      chunks: await one("SELECT COUNT(*) AS c FROM chunks"),
      edges: await one("SELECT COUNT(*) AS c FROM edges"),
      embedded: await one("SELECT COUNT(*) AS c FROM chunks WHERE embedding IS NOT NULL"),
      pending: await one("SELECT COUNT(*) AS c FROM chunks WHERE embedding IS NULL"),
    };
  }

  async ghNode(key: string): Promise<GhNode | undefined> {
    const r = await this.db.get("SELECT * FROM gh_nodes WHERE key = ?", [key]);
    return r ? toGh(r) : undefined;
  }

  async ghNodes(keys: string[]): Promise<GhNode[]> {
    if (!keys.length) return [];
    const rows = await this.db.all(`SELECT * FROM gh_nodes WHERE key IN (${keys.map(() => "?").join(", ")})`, keys);
    return rows.map(toGh);
  }

  /** Issues and pull requests, newest first. A number in `q` puts that number at the top. */
  async listGhNodes(f: GhFilter = {}): Promise<GhNode[]> {
    const esc = (v: string) => v.toLowerCase().replace(/[%_\\]/g, "\\$&");
    const parts: string[] = [];
    const params: string[] = [];
    if (f.repos) {
      if (f.repos.length === 0) parts.push("1 = 0");
      else {
        parts.push(`(${f.repos.map(() => "LOWER(key) LIKE ? ESCAPE '\\'").join(" OR ")})`);
        params.push(...f.repos.map((r) => `${esc(r)}#%`));
      }
    }
    for (const k of ["kind", "state"] as const) {
      if (f[k]) {
        parts.push(`${k} = ?`);
        params.push(f[k] as string);
      }
    }
    let order = "";
    const orderParams: string[] = [];
    const q = f.q?.trim().replace(/^@/, "");
    if (q) {
      const num = /^#?(\d+)$/.exec(q)?.[1];
      const text = ["key", "title", "labels", "author"].map((c) => `LOWER(${c}) LIKE ? ESCAPE '\\'`).join(" OR ");
      const t = `%${esc(q.replace(/^#/, ""))}%`;
      if (num) {
        parts.push(`(key LIKE ? ESCAPE '\\' OR ${text})`);
        params.push(`%#${num}`, t, t, t, t);
        order = "CASE WHEN key LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, ";
        orderParams.push(`%#${num}`);
      } else {
        parts.push(`(${text})`);
        params.push(t, t, t, t);
      }
    }
    const limit = Math.min(Math.max(Math.trunc(f.limit ?? 20), 1), 100);
    const rows = await this.db.all(
      `SELECT * FROM gh_nodes${parts.length ? " WHERE " + parts.join(" AND ") : ""} ORDER BY ${order}updated_at DESC, key LIMIT ${limit}`,
      [...params, ...orderParams],
    );
    return rows.map(toGh);
  }

  async upsertGhNode(n: GhNode, db: Db = this.db): Promise<void> {
    await db.run(
      `INSERT INTO gh_nodes (key, kind, state, title, labels, author, files, merged_at, url, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET kind = excluded.kind, state = excluded.state, title = excluded.title,
         labels = excluded.labels, author = excluded.author, files = excluded.files, merged_at = excluded.merged_at,
         url = excluded.url, updated_at = excluded.updated_at`,
      [n.key, n.kind, n.state, n.title, JSON.stringify(n.labels), n.author, JSON.stringify(n.files), n.merged_at, n.url, n.updated_at],
    );
  }

  async edgesFrom(id: string): Promise<EdgeRow[]> {
    return (await this.db.all("SELECT * FROM edges WHERE from_note = ? ORDER BY line, id", [id])) as unknown as EdgeRow[];
  }

  async edgesTo(id: string): Promise<EdgeRow[]> {
    return (await this.db.all("SELECT * FROM edges WHERE to_note = ? ORDER BY from_note, line", [id])) as unknown as EdgeRow[];
  }

  /** Notes that link to a GitHub key (`gh:owner/repo#n`). */
  async notesLinkingToGh(key: string): Promise<{ note: NoteRow; link_type: string }[]> {
    const rows = await this.db.all<Row>(
      `SELECT n.*, e.link_type AS _lt FROM edges e JOIN notes n ON n.id = e.from_note WHERE e.kind = 'github' AND e.to_ref = ?`,
      [`gh:${key}`],
    );
    return rows.map((r) => ({ note: toNote(r), link_type: r["_lt"] as string }));
  }

  /** All embeddings in memory. Brute-force cosine is enough up to ~50k chunks. */
  async vectors(): Promise<VectorItem[]> {
    const v = await this.version();
    if (this.vecCache?.version === v) return this.vecCache.items;
    const rows = await this.db.all<Row>("SELECT id, note_id, embedding FROM chunks WHERE embedding IS NOT NULL");
    const items = rows.map((r) => ({ chunkId: r["id"] as string, noteId: r["note_id"] as string, vec: bytesToVec(r["embedding"]) }));
    this.vecCache = { version: v, items };
    return items;
  }

  /** Resolved edges in memory, for graph queries. */
  async graph(): Promise<GraphData> {
    const v = await this.version();
    if (this.graphCache?.version === v) return this.graphCache.data;
    const notes = await this.db.all<Row>("SELECT id, title, type, status, space FROM notes");
    const edges = (await this.db.all("SELECT * FROM edges")) as unknown as EdgeRow[];
    const data: GraphData = {
      nodes: new Map(notes.map((n) => [n["id"] as string, n as never])),
      edges,
      out: new Map(),
      in: new Map(),
    };
    for (const e of edges) {
      (data.out.get(e.from_note) ?? data.out.set(e.from_note, []).get(e.from_note))?.push(e);
      if (e.to_note) (data.in.get(e.to_note) ?? data.in.set(e.to_note, []).get(e.to_note))?.push(e);
    }
    this.graphCache = { version: v, data };
    return data;
  }
}
