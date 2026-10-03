import { search, type IndexStore, type NoteFilter, type SearchHit } from "@defluance/indexer";
import type { Embedder } from "@defluance/shared";
import type { Llm } from "./providers.js";

export interface Citation {
  /** Citation number in the answer text: `[1]`. */
  n: number;
  note: string;
  title: string;
  heading: string;
  commit: string | null;
  snippet: string;
}

export interface AskResult {
  answer: string;
  citations: Citation[];
  /** True when no source supported an answer: nothing is invented. */
  refused: boolean;
  mode: "llm" | "extractive";
}

export interface AskOptions extends NoteFilter {
  embedder?: Embedder | null;
  llm?: Llm | null;
  /** Sources given to the model. */
  k?: number;
  /** Extractive mode only: minimum cosine for a vector-only match to count as a source. */
  minVector?: number;
}

export const NO_SOURCE = "No source found for this question.";

const SYSTEM = [
  "You answer questions about a team's specification notes.",
  "Use ONLY the numbered sources provided. Never use outside knowledge.",
  "After every claim, cite the supporting source numbers like [1] or [2][3].",
  "If the sources do not contain the answer, reply with exactly: NO_SOURCE",
  "Answer in the language of the question, concisely.",
].join(" ");

interface Source {
  hit: SearchHit;
  content: string;
}

async function loadSources(store: IndexStore, hits: SearchHit[]): Promise<Source[]> {
  if (!hits.length) return [];
  const rows = await store.db.all<{ id: string; content: string }>(
    `SELECT id, content FROM chunks WHERE id IN (${hits.map(() => "?").join(", ")})`,
    hits.map((h) => h.chunk.id),
  );
  const byId = new Map(rows.map((r) => [r.id, r.content]));
  return hits.map((hit) => ({ hit, content: byId.get(hit.chunk.id) ?? hit.chunk.snippet }));
}

const cite = (s: Source, n: number): Citation => ({
  n,
  note: s.hit.note.id,
  title: s.hit.note.title,
  heading: s.hit.chunk.heading,
  commit: s.hit.chunk.commit,
  snippet: s.hit.chunk.snippet,
});

const refusal = (mode: AskResult["mode"]): AskResult => ({ answer: NO_SOURCE, citations: [], refused: true, mode });

/**
 * Answer a question from the vault, with mandatory citations.
 * A citation is only ever a chunk that was retrieved: the model cannot invent one.
 * No source, or an answer citing nothing valid, is a refusal.
 */
export async function ask(store: IndexStore, question: string, opts: AskOptions = {}): Promise<AskResult> {
  const mode = opts.llm ? "llm" : "extractive";
  const filter = { space: opts.space, spaces: opts.spaces, type: opts.type, status: opts.status, tag: opts.tag, owner: opts.owner };
  let hits = await search(store, question, { ...filter, embedder: opts.embedder ?? null, limit: opts.k ?? 6 });

  if (!opts.llm) {
    const min = opts.minVector ?? 0.25;
    hits = hits.filter((h) => h.sources.includes("fts") || (h.vector ?? 0) >= min);
  }
  const sources = await loadSources(store, hits);
  if (!sources.length) return refusal(mode);

  if (!opts.llm) {
    const top = sources.slice(0, 3);
    const answer = top.map((s, i) => `${s.hit.chunk.snippet} [${i + 1}]`).join("\n\n");
    return { answer, citations: top.map((s, i) => cite(s, i + 1)), refused: false, mode };
  }

  const prompt =
    `Question: ${question}\n\nSources:\n` +
    sources.map((s, i) => `[${i + 1}] ${s.hit.note.title} > ${s.hit.chunk.heading}\n${s.content}`).join("\n\n");
  const text = (await opts.llm.generate(SYSTEM, prompt)).trim();
  if (!text || /^NO_SOURCE\b/.test(text)) return refusal(mode);

  const used: number[] = [];
  const cleaned = text.replace(/\[(\d+)\]/g, (m, d: string) => {
    const n = Number(d);
    if (n < 1 || n > sources.length) return ""; // invented source number
    if (!used.includes(n)) used.push(n);
    return m;
  });
  if (!used.length) return refusal(mode);
  return {
    answer: cleaned.replace(/[ \t]+([.,;:])/g, "$1").trim(),
    citations: used.map((n) => cite(sources[n - 1] as Source, n)),
    refused: false,
    mode,
  };
}
