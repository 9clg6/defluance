import { search, type NoteFilter, type SearchHit } from "@defluance/indexer";
import type { Embedder } from "@defluance/shared";
import type { Llm } from "./providers.js";

export interface SmartSearchOptions extends NoteFilter {
  embedder?: Embedder | null;
  llm?: Llm | null;
  limit?: number | undefined;
  passages?: number | undefined;
  /** Ask the model to order the best candidates. One more model call. */
  rerank?: boolean | undefined;
  /** Types and statuses of this vault: the only values the model may turn into filters. */
  vocabulary?: { types: string[]; statuses: string[] };
}

export interface Understood {
  /** The question and the reformulations that were searched. */
  queries: string[];
  /** Filters the model inferred from the question (explicit filters are not listed). */
  filters: { type?: string; status?: string; tag?: string };
  /** The inferred filters found too little, so they were dropped. */
  filtersDropped: boolean;
  reranked: boolean;
  /** Why plain hybrid search was used instead. */
  fallback?: string;
}

export interface SmartResult {
  hits: SearchHit[];
  understood: Understood;
}

const PLAN_SYSTEM = [
  "You turn a question into searches over a team's vault of specifications, decisions and notes.",
  'Reply with JSON only, no text around it: {"queries": ["..."], "filters": {"type": "...", "status": "..."}}.',
  "queries: up to 3 searches. Rephrase with synonyms and the key terms, short. If the question is in English or French, add the other language.",
  "filters: set one only when the question clearly asks for it (\"approved specs\" means status approved). Otherwise leave filters empty.",
].join(" ");

export interface Plan {
  queries: string[];
  filters: { type?: string; status?: string; tag?: string };
}

/** Read the model's plan defensively: anything unexpected is ignored, never trusted. */
export function parsePlan(text: string, vocab: { types: string[]; statuses: string[] }): Plan {
  const plan: Plan = { queries: [], filters: {} };
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return plan;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return plan;
  }
  const o = (data && typeof data === "object" ? data : {}) as { queries?: unknown; filters?: unknown };
  if (Array.isArray(o.queries)) {
    plan.queries = o.queries
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 3);
  }
  const f = (o.filters && typeof o.filters === "object" ? o.filters : {}) as Record<string, unknown>;
  if (typeof f["type"] === "string" && vocab.types.includes(f["type"])) plan.filters.type = f["type"];
  if (typeof f["status"] === "string" && vocab.statuses.includes(f["status"])) plan.filters.status = f["status"];
  if (typeof f["tag"] === "string" && /^[\w-]{1,40}$/.test(f["tag"])) plan.filters.tag = f["tag"];
  return plan;
}

const RRF_K = 60;

/** Fuse ranked lists of notes: a note ranked well by several reformulations rises. */
export function fuse(lists: SearchHit[][]): SearchHit[] {
  const score = new Map<string, number>();
  const best = new Map<string, { hit: SearchHit; rank: number }>();
  const sources = new Map<string, Set<"fts" | "vector">>();
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const id = hit.note.id;
      score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
      const b = best.get(id);
      if (!b || rank < b.rank) best.set(id, { hit, rank });
      const s = sources.get(id) ?? sources.set(id, new Set()).get(id);
      for (const x of hit.sources) s?.add(x);
    });
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, s]) => ({ ...(best.get(id) as { hit: SearchHit }).hit, score: s, sources: [...(sources.get(id) ?? [])] }));
}

const RERANK_SYSTEM = [
  "You order search results by how well they answer the question.",
  'Reply with JSON only: {"order": [numbers]}, the most relevant first, leaving out results that are not relevant.',
].join(" ");

export function parseOrder(text: string, count: number): number[] | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return null;
  try {
    const order = (JSON.parse(json) as { order?: unknown }).order;
    if (!Array.isArray(order)) return null;
    const seen = new Set<number>();
    for (const n of order) if (Number.isInteger(n) && n >= 1 && n <= count) seen.add(n as number);
    return seen.size ? [...seen] : null;
  } catch {
    return null;
  }
}

/**
 * Search with a model in front: it rewrites the question into several searches (and the other language),
 * infers filters, and can order the candidates. Without a model, or if it fails, this is plain hybrid search.
 */
export async function smartSearch(store: Parameters<typeof search>[0], question: string, opts: SmartSearchOptions = {}): Promise<SmartResult> {
  const limit = opts.limit ?? 10;
  const base = { space: opts.space, spaces: opts.spaces, type: opts.type, status: opts.status, tag: opts.tag, owner: opts.owner, ids: opts.ids, embedder: opts.embedder ?? null, passages: opts.passages };
  const run = (q: string, extra: { type?: string; status?: string; tag?: string } = {}) =>
    search(store, q, { ...base, type: base.type ?? extra.type, status: base.status ?? extra.status, tag: base.tag ?? extra.tag, limit: 20 });

  const understood: Understood = { queries: [question], filters: {}, filtersDropped: false, reranked: false };
  if (!opts.llm) {
    understood.fallback = "no language model configured";
    return { hits: (await run(question)).slice(0, limit), understood };
  }

  let plan: Plan = { queries: [], filters: {} };
  try {
    const vocab = opts.vocabulary ?? { types: [], statuses: [] };
    const prompt = `Question: ${question}\nTypes in this vault: ${vocab.types.join(", ") || "none"}\nStatuses: ${vocab.statuses.join(", ") || "none"}`;
    plan = parsePlan(await opts.llm.generate(PLAN_SYSTEM, prompt), vocab);
  } catch (e) {
    understood.fallback = `the model could not plan the search: ${e instanceof Error ? e.message : String(e)}`;
  }

  const queries = [...new Set([question, ...plan.queries])];
  understood.queries = queries;
  const inferred = Object.fromEntries(Object.entries(plan.filters).filter(([k]) => !(opts as Record<string, unknown>)[k]));
  understood.filters = inferred;

  let lists = await Promise.all(queries.map((q) => run(q, inferred)));
  let hits = fuse(lists);
  if (Object.keys(inferred).length && hits.length < Math.min(3, limit)) {
    // a guessed filter must never hide the answer
    lists = await Promise.all(queries.map((q) => run(q)));
    hits = fuse(lists);
    understood.filtersDropped = true;
  }

  if (opts.rerank && hits.length > 1) {
    const top = hits.slice(0, 15);
    try {
      const listing = top.map((h, i) => `${i + 1}. ${h.note.title} > ${h.chunk.heading}: ${h.chunk.snippet.slice(0, 300)}`).join("\n");
      const order = parseOrder(await opts.llm.generate(RERANK_SYSTEM, `Question: ${question}\n\nResults:\n${listing}`), top.length);
      if (order) {
        const ranked = order.map((n) => top[n - 1] as SearchHit);
        const rest = hits.filter((h) => !ranked.includes(h));
        hits = [...ranked, ...rest];
        understood.reranked = true;
      }
    } catch {
      // keep the fused order
    }
  }
  return { hits: hits.slice(0, limit), understood };
}
