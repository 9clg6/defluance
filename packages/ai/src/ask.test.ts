import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IndexStore, indexVault, openSqlite } from "@defluance/indexer";
import { hashEmbedder } from "@defluance/shared";
import { ask, NO_SOURCE } from "./ask.js";
import { evaluate, parseQuestions } from "./eval.js";
import type { Llm } from "./providers.js";

const VAULT = fileURLToPath(new URL("../../../fixtures/vault-eval", import.meta.url));
const embedder = hashEmbedder();
let store: IndexStore;

beforeAll(async () => {
  store = await IndexStore.open(openSqlite(":memory:"));
  await indexVault(store, { root: VAULT, embedder, commit: "c0ffee1" });
});
afterAll(() => store.db.close());

const llm = (reply: string | ((prompt: string) => string)): Llm & { prompts: string[] } => {
  const prompts: string[] = [];
  return { id: "fake:model", prompts, generate: async (_s, p) => (prompts.push(p), typeof reply === "function" ? reply(p) : reply) };
};

describe("ask (extractive, no LLM)", () => {
  it("answers with citations that carry note, heading and commit", async () => {
    const r = await ask(store, "How long is a password reset link valid?", { embedder });
    expect(r).toMatchObject({ refused: false, mode: "extractive" });
    expect(r.citations[0]).toMatchObject({ n: 1, note: "password-reset", heading: "Password reset", commit: "c0ffee1" });
    expect(r.answer).toContain("[1]");
  });

  it("refuses when the vault has nothing", async () => {
    expect(await ask(store, "How tall is Mount Everest?", { embedder })).toEqual({ answer: NO_SOURCE, citations: [], refused: true, mode: "extractive" });
  });

  it("applies filters and permissions to retrieval", async () => {
    expect((await ask(store, "How long is a password reset link valid?", { embedder, type: "technical-spec" })).citations.map((c) => c.note)).not.toContain("password-reset");
    expect((await ask(store, "How long is a password reset link valid?", { embedder, spaces: [] })).refused).toBe(true);
  });
});

describe("ask (LLM)", () => {
  it("passes numbered sources to the model and keeps only the cited ones", async () => {
    const model = llm("The link is valid for one hour [1]. It works once [1][2].");
    const r = await ask(store, "How long is a password reset link valid?", { embedder, llm: model });
    expect(model.prompts[0]).toContain("[1] Password reset > Password reset");
    expect(model.prompts[0]).toContain("valid for one hour");
    expect(r.mode).toBe("llm");
    expect(r.refused).toBe(false);
    expect(r.citations.map((c) => c.n)).toEqual([1, 2]);
    expect(r.citations[0]?.note).toBe("password-reset");
  });

  it("strips invented source numbers", async () => {
    const r = await ask(store, "How long is a password reset link valid?", { embedder, llm: llm("One hour [1] and also something [99].") });
    expect(r.answer).toBe("One hour [1] and also something.");
    expect(r.citations.map((c) => c.n)).toEqual([1]);
  });

  it("refuses an answer without any valid citation", async () => {
    expect((await ask(store, "How long is a password reset link valid?", { embedder, llm: llm("One hour.") })).refused).toBe(true);
    expect((await ask(store, "How long is a password reset link valid?", { embedder, llm: llm("One hour [42].") })).refused).toBe(true);
  });

  it("refuses when the model says NO_SOURCE, and does not call it without sources", async () => {
    expect((await ask(store, "How long is a password reset link valid?", { embedder, llm: llm("NO_SOURCE") })).refused).toBe(true);
    const model = llm("anything [1]");
    expect((await ask(store, "How long is a password reset link valid?", { embedder, spaces: [], llm: model })).refused).toBe(true);
    expect(model.prompts).toHaveLength(0);
  });
});

describe("RAG evaluation set (30 questions)", () => {
  it("answers 24 with valid citations and refuses the 6 others, extractive mode", async () => {
    const questions = parseQuestions(await readFile(`${VAULT}/questions.yaml`, "utf8"));
    expect(questions).toHaveLength(30);
    const report = await evaluate(store, questions, { embedder });
    expect(report.failures).toEqual([]);
    expect(report).toMatchObject({ total: 30, passed: 30, answered: 24, validCitations: 24 });
  });
});
