import { parse } from "yaml";
import type { IndexStore } from "@defluance/indexer";
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
