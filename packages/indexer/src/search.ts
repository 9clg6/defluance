import { cosine, DEFAULT_MIN_SIMILARITY, queryTokens, type Embedder } from "@defluance/shared";
import type { Row } from "./db.js";
import { noteWhere, toNote, type IndexStore, type NoteFilter } from "./store.js";

/** `keyword`: words only. `meaning`: vectors only. `hybrid`: both, fused. */
export type SearchMode = "keyword" | "meaning" | "hybrid";

export interface SearchOptions extends NoteFilter {
  limit?: number | undefined;
  /** Without an embedder, search is full-text only. */
  embedder?: Embedder | null;
  mode?: SearchMode | undefined;
  /** Passages returned per note (best first). Default 1. */
  passages?: number | undefined;
  /** How much each side counts in the hybrid fusion. Default 1 and 1. */
  weights?: { fts?: number; vector?: number } | undefined;
}

export interface SearchHit {
  note: { id: string; title: string; type: string | null; status: string | null; space: string; tags: string[] };
  chunk: { id: string; heading: string; snippet: string; commit: string | null };
  /** The best passage first, then other matching passages of the same note when `passages` > 1. */
  more?: { id: string; heading: string; snippet: string; commit: string | null }[];
  score: number;
  /** Best cosine similarity of the note's matching chunk, when the vector index matched it. */
  vector?: number;
  sources: ("fts" | "vector")[];
}

interface ChunkRow {
  id: string;
  note_id: string;
  heading: string;
  content: string;
  commit_sha: string | null;
}

const PER_SOURCE = 50;
const RRF_K = 60;
/** Measured on fixtures/vault-semantic: 77% to 82% first-place hits on paraphrases, no loss on exact terms. */
export const VECTOR_WEIGHT = 1.5;

function snippet(content: string, tokens: string[]): string {
  const lower = content.toLowerCase();
  let at = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  const start = Math.max(0, (at === -1 ? 0 : at) - 60);
  const text = content.slice(start, start + 240).replace(/\s+/g, " ").trim();
  return (start > 0 ? "… " : "") + text + (start + 240 < content.length ? " …" : "");
}

async function ftsSearch(store: IndexStore, tokens: string[], f: NoteFilter): Promise<ChunkRow[]> {
  if (!tokens.length) return [];
  const w = noteWhere(f);
  const cols = "c.id, c.note_id, c.heading, c.content, c.commit_sha";
  if (store.db.dialect === "sqlite") {
    const match = tokens.slice(0, 12).map((t) => `"${t}"*`).join(" OR ");
    return (await store.db.all(
      `SELECT ${cols} FROM chunks_fts JOIN chunks c ON c.rid = chunks_fts.rowid JOIN notes n ON n.id = c.note_id
       WHERE chunks_fts MATCH ?${w.sql} ORDER BY bm25(chunks_fts, 1.0, 2.0, 3.0) LIMIT ?`,
      [match, ...w.params, PER_SOURCE],
    )) as unknown as ChunkRow[];
  }
  const q = tokens.slice(0, 12).map((t) => `${t}:*`).join(" | ");
  return (await store.db.all(
    `SELECT ${cols} FROM chunks c JOIN notes n ON n.id = c.note_id, to_tsquery('simple', ?) q
     WHERE c.tsv @@ q${w.sql} ORDER BY ts_rank(c.tsv, q) DESC LIMIT ?`,
    [q, ...w.params, PER_SOURCE],
  )) as unknown as ChunkRow[];
}

async function vectorSearch(store: IndexStore, embedder: Embedder, query: string, f: NoteFilter): Promise<{ id: string; s: number }[]> {
  const items = await store.vectors();
  if (!items.length) return [];
  const filtered = Object.values(f).some((v) => v !== undefined);
  let allowed: Set<string> | undefined;
  if (filtered) {
    const w = noteWhere(f);
    allowed = new Set((await store.db.all<{ id: string }>(`SELECT n.id FROM notes n WHERE 1 = 1${w.sql}`, w.params)).map((r) => r.id));
  }
  const q = embedder.embedQuery ? await embedder.embedQuery(query) : (await embedder.embed([query]))[0];
  if (!q) return [];
  const floor = embedder.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const scored: { id: string; s: number }[] = [];
  for (const it of items) {
    if (allowed && !allowed.has(it.noteId)) continue;
    const s = cosine(q, it.vec);
    if (s >= floor) scored.push({ id: it.chunkId, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, PER_SOURCE);
}

/** Hybrid search: BM25 + cosine fused with reciprocal rank fusion, best chunk per note. */
export async function search(store: IndexStore, query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const filter: NoteFilter = { space: opts.space, spaces: opts.spaces, type: opts.type, status: opts.status, tag: opts.tag, owner: opts.owner, ids: opts.ids };

  const mode = opts.mode ?? "hybrid";
  const fts = mode === "meaning" ? [] : await ftsSearch(store, tokens, filter);
  const vec = opts.embedder && mode !== "keyword" ? await vectorSearch(store, opts.embedder, query, filter) : [];
  const cos = new Map(vec.map((v) => [v.id, v.s]));

  const score = new Map<string, number>();
  const sources = new Map<string, Set<"fts" | "vector">>();
  // A real model is trusted a bit more than word matches on paraphrased questions; shared-word vectors are not.
  const w = { fts: opts.weights?.fts ?? 1, vector: opts.weights?.vector ?? (opts.embedder?.semantic ? VECTOR_WEIGHT : 1) };
  const bump = (id: string, rank: number, src: "fts" | "vector") => {
    score.set(id, (score.get(id) ?? 0) + w[src] / (RRF_K + rank + 1));
    (sources.get(id) ?? sources.set(id, new Set()).get(id))?.add(src);
  };
  fts.forEach((c, i) => bump(c.id, i, "fts"));
  vec.forEach((v, i) => bump(v.id, i, "vector"));

  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const chunks = new Map<string, ChunkRow>(fts.map((c) => [c.id, c]));
  const missing = ranked.map(([id]) => id).filter((id) => !chunks.has(id));
  if (missing.length) {
    const rows = (await store.db.all(
      `SELECT id, note_id, heading, content, commit_sha FROM chunks WHERE id IN (${missing.map(() => "?").join(", ")})`,
      missing,
    )) as unknown as ChunkRow[];
    for (const r of rows) chunks.set(r.id, r);
  }

  const seen = new Set<string>();
  const picked: { chunk: ChunkRow; score: number; src: ("fts" | "vector")[]; cos: number | undefined; more: ChunkRow[] }[] = [];
  const perNote = Math.max(1, Math.min(opts.passages ?? 1, 5));
  const byNote = new Map<string, number>();
  for (const [id, s] of ranked) {
    const chunk = chunks.get(id);
    if (!chunk) continue;
    if (seen.has(chunk.note_id)) {
      const hit = picked[byNote.get(chunk.note_id) as number];
      if (hit && hit.more.length < perNote - 1) hit.more.push(chunk);
      continue;
    }
    if (picked.length >= (opts.limit ?? 20)) continue; // keep filling the passages of notes already picked
    seen.add(chunk.note_id);
    byNote.set(chunk.note_id, picked.length);
    picked.push({ chunk, score: s, src: [...(sources.get(id) ?? [])], cos: cos.get(id), more: [] });
  }
  if (!picked.length) return [];

  const ids = picked.map((p) => p.chunk.note_id);
  const notes = new Map(
    (await store.db.all<Row>(`SELECT * FROM notes WHERE id IN (${ids.map(() => "?").join(", ")})`, ids)).map((r) => [r["id"] as string, toNote(r)]),
  );
  return picked.flatMap((p) => {
    const n = notes.get(p.chunk.note_id);
    if (!n) return [];
    return [
      {
        note: { id: n.id, title: n.title, type: n.type, status: n.status, space: n.space, tags: n.tags },
        chunk: { id: p.chunk.id, heading: p.chunk.heading, snippet: snippet(p.chunk.content, tokens), commit: p.chunk.commit_sha },
        ...(p.more.length ? { more: p.more.map((c) => ({ id: c.id, heading: c.heading, snippet: snippet(c.content, tokens), commit: c.commit_sha })) } : {}),
        score: p.score,
        ...(p.cos === undefined ? {} : { vector: p.cos }),
        sources: p.src,
      },
    ];
  });
}
