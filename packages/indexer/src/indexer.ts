import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Embedder } from "@defluance/shared";
import {
  bodyOf,
  buildVault,
  isEncrypted,
  defaultConfig,
  listMarkdown,
  parseNote,
  skipped,
  spaceOf,
  type Link,
  type ParsedNote,
  type VaultConfig,
} from "@defluance/vault-core";
import { bytesToVec, vecToBytes, type Db } from "./db.js";
import { chunkBody, sha256 } from "./chunk.js";
import { IndexStore } from "./store.js";

export interface IndexOptions {
  root: string;
  /** null = full-text only. */
  embedder?: Embedder | null;
  /** HEAD of the vault, stored on notes and chunks for citations. */
  commit?: string | null;
  /**
   * Store text first and leave vectors for `backfillEmbeddings`. Default: on when the embedder is slow
   * (a real model), off otherwise. Search works by words at once, by meaning as vectors arrive.
   */
  deferEmbeddings?: boolean;
  /**
   * Read a note's text. Default: the file. The private index passes a reader that decrypts, so the plaintext
   * of an encrypted note only ever exists in that in-memory index.
   */
  read?: (path: string) => Promise<string>;
  /** Only (re)index these note paths (`specs/a.md`). Absent files are removed. Default: scan the whole vault. */
  paths?: string[];
  config?: VaultConfig;
  linkTypes?: readonly string[];
}

export interface IndexReport {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  chunks: number;
  embedded: number;
  cacheHits: number;
  /** Chunks stored without a vector, waiting for `backfillEmbeddings`. */
  deferred: number;
  /** Encrypted notes stored as locked placeholders: header only, no text. */
  locked: number;
  full: boolean;
}

const BATCH = 64;

export async function embedAll(
  store: IndexStore,
  embedder: Embedder,
  items: { key: string; text: string }[],
): Promise<{ vectors: Map<string, Float32Array>; hits: number; computed: number }> {
  const vectors = new Map<string, Float32Array>();
  const unique = [...new Map(items.map((i) => [i.key, i])).values()];
  let hits = 0;

  for (let i = 0; i < unique.length; i += 400) {
    const slice = unique.slice(i, i + 400);
    const rows = await store.db.all<{ hash: string; vector: unknown }>(
      `SELECT hash, vector FROM embedding_cache WHERE model = ? AND hash IN (${slice.map(() => "?").join(", ")})`,
      [embedder.model, ...slice.map((s) => s.key)],
    );
    for (const r of rows) {
      vectors.set(r.hash, bytesToVec(r.vector));
      hits++;
    }
  }

  const misses = unique.filter((u) => !vectors.has(u.key));
  for (let i = 0; i < misses.length; i += BATCH) {
    const batch = misses.slice(i, i + BATCH);
    const out = await embedder.embed(batch.map((b) => b.text));
    if (out.length !== batch.length) throw new Error(`embedder returned ${out.length} vectors for ${batch.length} texts`);
    await store.db.transaction(async (tx) => {
      for (const [j, item] of batch.entries()) {
        const v = out[j] as Float32Array;
        vectors.set(item.key, v);
        await tx.run(
          "INSERT INTO embedding_cache (model, hash, vector) VALUES (?, ?, ?) ON CONFLICT (model, hash) DO NOTHING",
          [embedder.model, item.key, vecToBytes(v)],
        );
      }
    });
  }
  return { vectors, hits, computed: misses.length };
}

/**
 * Re-resolve every wikilink against the notes currently in the index.
 * Needed after any add/remove: an unchanged note may now point to a new target.
 */
export async function resolveEdges(store: IndexStore, root: string, db: Db = store.db): Promise<void> {
  const rows = await db.all<{ id: string; path: string; title: string; frontmatter: string; headings: string }>(
    "SELECT id, path, title, frontmatter, headings FROM notes",
  );
  const notes: ParsedNote[] = rows.map((r) => ({
    id: r.id,
    path: r.path,
    title: r.title,
    frontmatter: JSON.parse(r.frontmatter) as Record<string, unknown>,
    headings: JSON.parse(r.headings) as ParsedNote["headings"],
    links: [],
  }));
  const vault = buildVault(root, notes);
  const edges = await db.all<{ id: string; from_note: string; to_ref: string; heading: string | null; link_type: string; to_note: string | null }>(
    "SELECT id, from_note, to_ref, heading, link_type, to_note FROM edges WHERE kind = 'note'",
  );
  for (const e of edges) {
    const link: Link = { target: e.to_ref, kind: "note", type: e.link_type, strict: false, source: "body", line: 1 };
    if (e.heading) link.heading = e.heading;
    const res = vault.resolve(link, e.from_note);
    const to = res.status === "resolved" ? res.note.id : null;
    if (to !== e.to_note) await db.run("UPDATE edges SET to_note = ? WHERE id = ?", [to, e.id]);
  }
}

export async function indexVault(store: IndexStore, opts: IndexOptions): Promise<IndexReport> {
  const { root } = opts;
  const embedder = opts.embedder ?? null;
  const config = opts.config ?? defaultConfig;
  const commit = opts.commit ?? null;

  const previousModel = (await store.getMeta("embed_model")) ?? "";
  const model = embedder?.model ?? "";
  const modelChanged = previousModel !== model && (await store.counts()).notes > 0;

  const known = await store.noteHashes();
  const targeted = opts.paths && !modelChanged;
  const files = targeted
    ? [...new Set((opts.paths as string[]).map((p) => p.split("\\").join("/")).filter((p) => p.toLowerCase().endsWith(".md") && !skipped(p)))]
    : await listMarkdown(root);

  const report: IndexReport = { added: 0, updated: 0, removed: 0, unchanged: 0, chunks: 0, embedded: 0, cacheHits: 0, deferred: 0, locked: 0, full: !targeted };
  const defer = !!embedder && (opts.deferEmbeddings ?? embedder.slow === true);

  type Prepared = { note: ParsedNote; hash: string; chunks: ReturnType<typeof chunkBody>; isNew: boolean };
  const prepared: Prepared[] = [];
  const present = new Set<string>();
  const missing: string[] = [];

  for (const path of files) {
    let raw: string;
    try {
      raw = await (opts.read ? opts.read(path) : readFile(join(root, path), "utf8"));
    } catch {
      missing.push(path.replace(/\.md$/i, ""));
      continue;
    }
    const id = path.replace(/\.md$/i, "");
    present.add(id);
    const hash = sha256(raw);
    if (!modelChanged && known.get(id) === hash) {
      report.unchanged++;
      continue;
    }
    const note = parseNote(path, raw, opts.linkTypes ? { linkTypes: opts.linkTypes } : {});
    if (isEncrypted(raw)) {
      // Never index ciphertext, and never anything derived from it: only the public header (type, status, owner,
      // recipients) is kept, under the file name as title. The text lives in the private index while a key is unlocked.
      note.links = [];
      note.headings = [];
      report.locked++;
      prepared.push({ note, hash, chunks: [], isNew: !known.has(id) });
      continue;
    }
    prepared.push({ note, hash, chunks: chunkBody(bodyOf(raw), note.title), isNew: !known.has(id) });
  }

  const removedIds = targeted ? missing.filter((id) => known.has(id)) : [...known.keys()].filter((id) => !present.has(id));

  // Embeddings first (network may be slow), outside the write transaction.
  let vectors = new Map<string, Float32Array>();
  if (embedder && !defer) {
    const items = prepared.flatMap((p) =>
      p.chunks.map((c) => ({
        key: sha256(`${p.note.title}\n${c.hash}`),
        text: `${p.note.title}\n${c.heading}\n${c.content}`,
      })),
    );
    const r = await embedAll(store, embedder, items);
    vectors = r.vectors;
    report.cacheHits = r.hits;
    report.embedded = r.computed;
  }

  const now = new Date().toISOString();
  await store.db.transaction(async (tx) => {
    const drop = async (id: string) => {
      await tx.run("DELETE FROM chunks WHERE note_id = ?", [id]);
      await tx.run("DELETE FROM edges WHERE from_note = ?", [id]);
    };
    for (const id of removedIds) {
      await drop(id);
      await tx.run("DELETE FROM notes WHERE id = ?", [id]);
      report.removed++;
    }
    for (const { note, hash, chunks, isNew } of prepared) {
      await drop(note.id);
      const fm = note.frontmatter;
      const str = (k: string) => (typeof fm[k] === "string" ? (fm[k] as string) : null);
      const tags = Array.isArray(fm["tags"]) ? fm["tags"].filter((t): t is string => typeof t === "string") : [];
      await tx.run(
        `INSERT INTO notes (id, path, space, type, status, owner, title, tags, frontmatter, headings, content_hash, commit_sha, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET path = excluded.path, space = excluded.space, type = excluded.type, status = excluded.status,
           owner = excluded.owner, title = excluded.title, tags = excluded.tags, frontmatter = excluded.frontmatter,
           headings = excluded.headings, content_hash = excluded.content_hash, commit_sha = excluded.commit_sha, updated_at = excluded.updated_at`,
        [
          note.id, note.path, spaceOf(config, note.id), str("type"), str("status"), str("owner"), note.title,
          JSON.stringify(tags), JSON.stringify(fm), JSON.stringify(note.headings), hash, commit, now,
        ],
      );
      for (const c of chunks) {
        const v = vectors.get(sha256(`${note.title}\n${c.hash}`));
        await tx.run(
          `INSERT INTO chunks (id, note_id, title, heading, ordinal, content, content_hash, embedding, commit_sha)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [`${note.id}#${c.ordinal}`, note.id, note.title, c.heading, c.ordinal, c.content, c.hash, v ? vecToBytes(v) : null, commit],
        );
        report.chunks++;
        if (defer) report.deferred++;
      }
      for (const [i, l] of note.links.entries()) {
        await tx.run(
          `INSERT INTO edges (id, from_note, to_ref, heading, kind, link_type, source, line, to_note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [`${note.id}:${i}`, note.id, l.target, l.heading ?? null, l.kind, l.type, l.source, l.line],
        );
      }
      if (isNew) report.added++;
      else report.updated++;
    }
    if (modelChanged) await tx.run("DELETE FROM embedding_cache WHERE model <> ?", [model]);
    await resolveEdges(store, root, tx);
    await store.setMeta("embed_model", model, tx);
    if (commit) await store.setMeta("last_commit", commit, tx);
    await store.setMeta("indexed_at", now, tx);
    await store.bump(tx);
  });
  return report;
}

export interface BackfillProgress {
  done: number;
  total: number;
}

/**
 * Compute the vectors that `indexVault` left out. Safe to run while notes change: it always picks up
 * whatever chunks still lack a vector. The index version is bumped as vectors arrive so searches see them.
 */
export async function backfillEmbeddings(
  store: IndexStore,
  embedder: Embedder,
  o: { batch?: number; onProgress?: (p: BackfillProgress) => void; signal?: AbortSignal } = {},
): Promise<BackfillProgress> {
  const batch = o.batch ?? 128;
  const count = async () => Number((await store.db.get<{ c: number | string }>("SELECT COUNT(*) AS c FROM chunks WHERE embedding IS NULL"))?.c ?? 0);
  const total = await count();
  let done = 0;
  let sinceBump = 0;
  o.onProgress?.({ done, total });
  while (!o.signal?.aborted) {
    const rows = await store.db.all<{ id: string; title: string; heading: string; content: string; content_hash: string }>(
      "SELECT id, title, heading, content, content_hash FROM chunks WHERE embedding IS NULL ORDER BY id LIMIT ?",
      [batch],
    );
    if (!rows.length) break;
    const items = rows.map((r) => ({ id: r.id, key: sha256(`${r.title}\n${r.content_hash}`), text: `${r.title}\n${r.heading}\n${r.content}` }));
    const { vectors } = await embedAll(store, embedder, items);
    await store.db.transaction(async (tx) => {
      for (const it of items) {
        const v = vectors.get(it.key);
        if (v) await tx.run("UPDATE chunks SET embedding = ? WHERE id = ?", [vecToBytes(v), it.id]);
      }
    });
    done += rows.length;
    sinceBump += rows.length;
    if (sinceBump >= 512) {
      await store.bump();
      sinceBump = 0;
    }
    o.onProgress?.({ done: Math.min(done, total), total: Math.max(total, done) });
  }
  if (sinceBump > 0) await store.bump();
  return { done, total: Math.max(total, done) };
}
