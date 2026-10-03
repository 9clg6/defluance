import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chunkBody, snippet, type Chunk, type IndexStore, type NoteFilter, type NoteRow, type SearchHit } from "@defluance/indexer";
import { queryTokens, tokenize } from "@defluance/shared";
import { DecryptError, bodyOf, decryptNote, parseNote, type ParsedNote } from "@defluance/vault-core";
import type { Held } from "./keys.js";

/** One decrypted note, in memory only. */
export interface PrivateNote {
  id: string;
  hash: string;
  plain: string;
  parsed: ParsedNote;
  chunks: Chunk[];
  row: NoteRow;
}

interface KeyIndex {
  notes: Map<string, PrivateNote>;
  running: Promise<void>;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Fingerprints a note is encrypted for, read from its public header in the index. */
export function recipientsOfRow(row: NoteRow): string[] {
  const e = row.frontmatter["encrypted"] as { recipients?: { fp?: unknown }[] } | undefined;
  return (e?.recipients ?? []).flatMap((r) => (typeof r.fp === "string" ? [r.fp] : []));
}

export const isPrivateRow = (row: NoteRow) => typeof row.frontmatter["encrypted"] === "object" && row.frontmatter["encrypted"] !== null;

/**
 * The text of encrypted notes, decrypted for as long as a key is unlocked, and searchable.
 *
 * Nothing here touches disk, the database or a model provider: the index lives in this process, one per key, and is
 * dropped when the key locks. Encrypted notes are found by words only (BM25 over their passages). Vector search would
 * need to store embeddings, and an embedding of private text is private text.
 */
export class PrivateIndex {
  private readonly byKey = new Map<string, KeyIndex>();
  private readonly touched = new Map<string, number>();

  constructor(
    private readonly store: IndexStore,
    private readonly root: string,
    private readonly linkTypes: () => Promise<readonly string[]>,
  ) {}

  /** Bring the key's private index up to date with the vault: new and changed notes are decrypted, gone ones dropped. */
  async sync(held: Held): Promise<Map<string, PrivateNote>> {
    const idx = this.byKey.get(held.fp) ?? { notes: new Map<string, PrivateNote>(), running: Promise.resolve() };
    this.byKey.set(held.fp, idx);
    this.touched.set(held.fp, Date.now());
    idx.running = idx.running.then(() => this.refresh(held, idx)).catch(() => undefined);
    await idx.running;
    return idx.notes;
  }

  private async refresh(held: Held, idx: KeyIndex) {
    const rows = (await this.store.encryptedNotes()).filter((r) => recipientsOfRow(r).includes(held.fp));
    const live = new Set(rows.map((r) => r.id));
    for (const id of idx.notes.keys()) if (!live.has(id)) idx.notes.delete(id);
    const linkTypes = await this.linkTypes();
    for (const row of rows) {
      if (idx.notes.get(row.id)?.hash === row.content_hash) continue;
      try {
        const raw = await readFile(join(this.root, row.path), "utf8");
        const plain = decryptNote(raw, held.key, held.fp);
        const parsed = parseNote(row.path, plain, { linkTypes });
        idx.notes.set(row.id, { id: row.id, hash: sha256(raw), plain, parsed, chunks: chunkBody(bodyOf(plain), parsed.title), row });
      } catch (e) {
        idx.notes.delete(row.id);
        if (!(e instanceof DecryptError)) throw e;
      }
    }
  }

  /** The notes readable with any of these keys, de-duplicated. */
  async notesFor(helds: Held[]): Promise<PrivateNote[]> {
    const out = new Map<string, PrivateNote>();
    for (const h of helds) for (const [id, n] of await this.sync(h)) out.set(id, n);
    return [...out.values()];
  }

  /** How many decrypted notes are held in memory for a key. */
  cached(fp: string): number {
    return this.byKey.get(fp)?.notes.size ?? 0;
  }

  drop(fp: string) {
    this.byKey.delete(fp);
    this.touched.delete(fp);
  }

  dropAll() {
    this.byKey.clear();
    this.touched.clear();
  }

  /** Forget the plaintext of keys nobody has used for a while: it must not outlive the unlock. */
  sweep(idleMs: number, now = Date.now()) {
    for (const [fp, at] of this.touched) if (now - at > idleMs) this.drop(fp);
  }
}

const matches = (n: PrivateNote, f: NoteFilter): boolean => {
  const r = n.row;
  if (f.space && r.space !== f.space) return false;
  if (f.spaces && !f.spaces.includes(r.space)) return false;
  if (f.ids && !f.ids.includes(r.id)) return false;
  if (f.type && r.type !== f.type) return false;
  if (f.status && r.status !== f.status) return false;
  if (f.owner && r.owner !== f.owner) return false;
  if (f.tag) {
    const tags = n.parsed.frontmatter["tags"];
    if (!Array.isArray(tags) || !tags.includes(f.tag)) return false;
  }
  return true;
};

const K1 = 1.2;
const B = 0.75;

export interface PrivateSource {
  hit: SearchHit;
  /** The whole passage, for answering from it. */
  content: string;
}

/** Keyword search over decrypted notes: BM25 per passage, the best passage speaks for its note. */
export function searchPrivate(notes: PrivateNote[], query: string, f: NoteFilter = {}, o: { limit?: number; passages?: number } = {}): SearchHit[] {
  return searchPrivateSources(notes, query, f, o).map((s) => s.hit);
}

export function searchPrivateSources(notes: PrivateNote[], query: string, f: NoteFilter = {}, o: { limit?: number; passages?: number } = {}): PrivateSource[] {
  const tokens = queryTokens(query);
  const pool = notes.filter((n) => matches(n, f));
  if (!tokens.length || !pool.length) return [];

  type Doc = { note: PrivateNote; chunk: Chunk; words: string[] };
  const docs: Doc[] = pool.flatMap((note) => note.chunks.map((chunk) => ({ note, chunk, words: tokenize(`${note.parsed.title} ${chunk.heading} ${chunk.content}`) })));
  if (!docs.length) return [];
  const avg = docs.reduce((n, d) => n + d.words.length, 0) / docs.length || 1;
  const hasWord = (d: Doc, t: string) => d.words.some((w) => w.startsWith(t));
  const idf = new Map(
    tokens.map((t) => {
      const df = docs.filter((d) => hasWord(d, t)).length;
      return [t, Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))] as const;
    }),
  );

  const scored = docs
    .map((d) => {
      let score = 0;
      for (const t of tokens) {
        const tf = d.words.filter((w) => w.startsWith(t)).length;
        if (tf) score += (idf.get(t) ?? 0) * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.words.length) / avg)));
      }
      return { d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const byNote = new Map<string, typeof scored>();
  for (const s of scored) byNote.set(s.d.note.id, [...(byNote.get(s.d.note.id) ?? []), s]);
  const passages = Math.max(1, o.passages ?? 1);
  const toChunk = (d: Doc) => ({ id: `${d.note.id}#${d.chunk.ordinal}`, heading: d.chunk.heading, snippet: snippet(d.chunk.content, tokens), commit: d.note.row.commit_sha });
  return [...byNote.values()]
    .slice(0, o.limit ?? 20)
    .map((list) => {
      const best = list[0] as (typeof scored)[number];
      const n = best.d.note;
      const more = list.slice(1, passages).map((x) => toChunk(x.d));
      return {
        hit: {
          note: { id: n.id, title: n.parsed.title, type: n.row.type, status: n.row.status, space: n.row.space, tags: Array.isArray(n.parsed.frontmatter["tags"]) ? (n.parsed.frontmatter["tags"] as string[]) : [] },
          chunk: toChunk(best.d),
          ...(more.length ? { more } : {}),
          score: best.score,
          sources: ["fts" as const],
          private: true,
        },
        content: best.d.chunk.content,
      };
    });
}
