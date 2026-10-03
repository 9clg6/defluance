import { parse } from "yaml";
import type { IndexStore } from "@defluance/indexer";
import { search, type SearchMode } from "@defluance/indexer";
import type { Embedder } from "@defluance/shared";
import { ask, type AskOptions } from "./ask.js";

export interface EvalQuestion {
  q: string;
  /** Note ids: at least one must be cited. */
  expect?: string[];
  /** The vault does not answer this: the correct outcome is a refusal. */
  refuse?: boolean;
}

export interface EvalFailure {
  q: string;
  reason: string;
}

export interface EvalReport {
  total: number;
  passed: number;
  /** Non-refused answers whose citations all point to notes that exist. */
  validCitations: number;
  answered: number;
  failures: EvalFailure[];
}

export function parseQuestions(yamlText: string): EvalQuestion[] {
  const data = parse(yamlText) as { questions?: EvalQuestion[] } | EvalQuestion[];
  return Array.isArray(data) ? data : (data.questions ?? []);
}

export async function evaluate(store: IndexStore, questions: EvalQuestion[], opts: AskOptions): Promise<EvalReport> {
  const report: EvalReport = { total: questions.length, passed: 0, validCitations: 0, answered: 0, failures: [] };
  for (const item of questions) {
    const r = await ask(store, item.q, opts);
    let reason: string | null = null;
    if (!r.refused) {
      report.answered++;
      const ids = r.citations.map((c) => c.note);
      const existing = (await Promise.all(ids.map((id) => store.getNote(id)))).every(Boolean);
      if (existing && ids.length > 0) report.validCitations++;
      else reason = "citation does not point to an existing note";
    }
    if (!reason) {
      if (item.refuse && !r.refused) reason = `should have refused, cited ${r.citations.map((c) => c.note).join(", ")}`;
      else if (!item.refuse && r.refused) reason = "refused but the vault has the answer";
      else if (!item.refuse && item.expect && !r.citations.some((c) => item.expect?.includes(c.note))) {
        reason = `cited ${r.citations.map((c) => c.note).join(", ")}, expected one of ${item.expect.join(", ")}`;
      }
    }
    if (reason) report.failures.push({ q: item.q, reason });
    else report.passed++;
  }
  return report;
}

export interface SearchEvalReport {
  /** Questions that have an expected note. */
  total: number;
  recallAt1: number;
  recallAt3: number;
  /** Mean reciprocal rank of the first expected note (0 when it is not in the top 10). */
  mrr: number;
  misses: { q: string; got: string[] }[];
  /** Questions with no answer in the vault that still got results. */
  noise: { answered: number; of: number };
}

/** How well does search put the right note first? Measures the ranking, independent of any answer generation. */
export async function evaluateSearch(store: IndexStore, questions: EvalQuestion[], o: { embedder: Embedder | null; mode?: SearchMode; limit?: number; weights?: { fts?: number; vector?: number } }): Promise<SearchEvalReport> {
  const rep: SearchEvalReport = { total: 0, recallAt1: 0, recallAt3: 0, mrr: 0, misses: [], noise: { answered: 0, of: 0 } };
  for (const item of questions) {
    const hits = await search(store, item.q, { embedder: o.embedder, mode: o.mode ?? "hybrid", limit: o.limit ?? 10, weights: o.weights });
    const ids = hits.map((h) => h.note.id);
    if (item.refuse) {
      rep.noise.of++;
      if (ids.length) rep.noise.answered++;
      continue;
    }
    rep.total++;
    const rank = ids.findIndex((id) => item.expect?.includes(id));
    if (rank === 0) rep.recallAt1++;
    if (rank !== -1 && rank < 3) rep.recallAt3++;
    if (rank !== -1) rep.mrr += 1 / (rank + 1);
    else rep.misses.push({ q: item.q, got: ids.slice(0, 3) });
  }
  if (rep.total) {
    rep.recallAt1 /= rep.total;
    rep.recallAt3 /= rep.total;
    rep.mrr /= rep.total;
  }
  return rep;
}
