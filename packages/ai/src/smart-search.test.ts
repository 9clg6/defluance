import { fileURLToPath } from "node:url";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IndexStore, indexVault, openSqlite, search } from "@defluance/indexer";
import { hashEmbedder } from "@defluance/shared";
import { llmFromModel, type Llm } from "./providers.js";
import { fuse, parseOrder, parsePlan, smartSearch } from "./smart-search.js";

const VAULT = fileURLToPath(new URL("../../../fixtures/vault-eval", import.meta.url));
const embedder = hashEmbedder();
const vocabulary = { types: ["functional-spec", "technical-spec", "adr"], statuses: ["draft", "review", "approved"] };
let store: IndexStore;

beforeAll(async () => {
  store = await IndexStore.open(openSqlite(":memory:"));
  await indexVault(store, { root: VAULT, embedder });
});
afterAll(() => store.db.close());

/** An LLM that answers from a script, in order, and records what it was asked. */
const scripted = (...replies: (string | Error)[]): Llm & { prompts: string[] } => {
  const prompts: string[] = [];
  let i = 0;
  return {
    id: "fake",
    prompts,
    generate: async (_s, p) => {
      prompts.push(p);
      const r = replies[Math.min(i++, replies.length - 1)] as string | Error;
      if (r instanceof Error) throw r;
      return r;
    },
  };
};

describe("parsePlan", () => {
  it("reads queries and filters, also inside a code fence or after chatter", () => {
    const text = 'Sure!\n```json\n{"queries": ["reset link", " password recovery "], "filters": {"status": "approved", "type": "adr"}}\n```';
    expect(parsePlan(text, vocabulary)).toEqual({ queries: ["reset link", "password recovery"], filters: { status: "approved", type: "adr" } });
  });
  it("drops filter values the vault does not have, long queries, and keeps at most 3 queries", () => {
    const p = parsePlan(JSON.stringify({ queries: ["a", "b", "c", "d", "x".repeat(500)], filters: { type: "memo", status: "nope", tag: "ok-tag", owner: "x" } }), vocabulary);
    expect(p.queries).toEqual(["a", "b", "c"]);
    expect(p.filters).toEqual({ tag: "ok-tag" });
    expect(parsePlan(JSON.stringify({ filters: { tag: "bad tag!" } }), vocabulary).filters).toEqual({});
  });
  it("survives garbage", () => {
    for (const text of ["", "no json here", "{not json}", '{"queries": "string"}', "[1,2]"]) {
      expect(parsePlan(text, vocabulary)).toEqual({ queries: [], filters: {} });
    }
  });
});

describe("parseOrder", () => {
  it("keeps valid unique numbers in order", () => {
    expect(parseOrder('{"order": [3, 1, 3, 9, 0, "x", 2]}', 4)).toEqual([3, 1, 2]);
    expect(parseOrder("nonsense", 3)).toBeNull();
    expect(parseOrder('{"order": []}', 3)).toBeNull();
    expect(parseOrder('{"order": [9]}', 3)).toBeNull();
  });
});

describe("fuse", () => {
  const hit = (id: string, source: "fts" | "vector") => ({ note: { id, title: id, type: null, status: null, space: "default", tags: [] }, chunk: { id: `${id}#0`, heading: id, snippet: "", commit: null }, score: 0, sources: [source] });
  it("lifts notes that several searches agree on, and merges their sources", () => {
    const out = fuse([[hit("a", "fts"), hit("b", "fts")], [hit("c", "vector"), hit("b", "vector")]]);
    expect(out.map((h) => h.note.id)).toEqual(["b", "a", "c"]);
    expect(out[0]?.sources.sort()).toEqual(["fts", "vector"]);
  });
});

describe("smartSearch", () => {
  const question = "I lost my secret phrase, how do I get back in";

  it("without a model it is plain hybrid search, and says so", async () => {
    const r = await smartSearch(store, "reset link valid", { embedder, vocabulary });
    expect(r.understood.fallback).toMatch(/no language model/);
    expect(r.hits.map((h) => h.note.id)).toEqual((await search(store, "reset link valid", { embedder, limit: 10 })).map((h) => h.note.id));
  });

  it("a reformulation finds what the question's own words could not", async () => {
    const plain = await search(store, question, { embedder });
    expect(plain.map((h) => h.note.id)).not.toContain("password-reset");
    const llm = scripted('{"queries": ["password reset link email", "reset link valid one hour password"], "filters": {}}');
    const r = await smartSearch(store, question, { embedder, llm, vocabulary });
    expect(r.understood.queries).toEqual([question, "password reset link email", "reset link valid one hour password"]);
    expect(r.hits[0]?.note.id).toBe("password-reset");
    expect(r.understood.fallback).toBeUndefined();
    expect(llm.prompts[0]).toContain("Types in this vault: functional-spec, technical-spec, adr");
  });

  it("applies inferred filters, but never over explicit ones", async () => {
    const plan = '{"queries": ["email notification"], "filters": {"status": "approved"}}';
    const r = await smartSearch(store, "email", { embedder, llm: scripted(plan), vocabulary });
    expect(r.understood.filters).toEqual({ status: "approved" });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((h) => h.note.status === "approved")).toBe(true);

    const explicit = await smartSearch(store, "email", { embedder, llm: scripted(plan), vocabulary, status: "review" });
    expect(explicit.understood.filters).toEqual({});
    expect(explicit.hits.every((h) => h.note.status === "review")).toBe(true);
  });

  it("drops a guessed filter that leaves too little", async () => {
    const llm = scripted('{"queries": ["password reset"], "filters": {"type": "adr"}}');
    const r = await smartSearch(store, "password reset", { embedder, llm, vocabulary });
    expect(r.understood.filtersDropped).toBe(true);
    expect(r.hits[0]?.note.id).toBe("password-reset");
  });

  it("reranks when asked, and ignores a bad or failing reranker", async () => {
    const plan = '{"queries": [], "filters": {}}';
    const base = await smartSearch(store, "invoice tax refund", { embedder, llm: scripted(plan), vocabulary });
    expect(base.hits.length).toBeGreaterThan(2);
    const ids = base.hits.map((h) => h.note.id);

    const swapped = await smartSearch(store, "invoice tax refund", { embedder, llm: scripted(plan, '{"order": [2, 1]}'), vocabulary, rerank: true });
    expect(swapped.understood.reranked).toBe(true);
    expect(swapped.hits.slice(0, 2).map((h) => h.note.id)).toEqual([ids[1], ids[0]]);
    expect(swapped.hits.map((h) => h.note.id).sort()).toEqual([...ids].sort());

    const bad = await smartSearch(store, "invoice tax refund", { embedder, llm: scripted(plan, "I cannot do that"), vocabulary, rerank: true });
    expect(bad.understood.reranked).toBe(false);
    expect(bad.hits.map((h) => h.note.id)).toEqual(ids);

    const failing = await smartSearch(store, "invoice tax refund", { embedder, llm: scripted(plan, new Error("rate limited")), vocabulary, rerank: true });
    expect(failing.understood.reranked).toBe(false);
    expect(failing.hits.map((h) => h.note.id)).toEqual(ids);
  });

  it("a failing planner still returns the plain results, with the reason", async () => {
    const r = await smartSearch(store, "password reset", { embedder, llm: scripted(new Error("503 overloaded")), vocabulary });
    expect(r.understood.fallback).toContain("503 overloaded");
    expect(r.hits[0]?.note.id).toBe("password-reset");
  });

  it("respects permissions: hidden spaces never show up, whatever the model proposes", async () => {
    const llm = scripted('{"queries": ["password reset link email"], "filters": {}}');
    const r = await smartSearch(store, question, { embedder, llm, vocabulary, spaces: [] });
    expect(r.hits).toEqual([]);
  });
});

describe("smartSearch with a real model object (native structured output)", () => {
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  const json = (o: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(o) }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] });

  it("asks for a JSON object with a schema, and still refuses values outside the vocabulary", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [json({ queries: ["password reset link email"], filters: { status: "approved", type: "made-up-type" } })] });
    const r = await smartSearch(store, "I lost my secret phrase, how do I get back in", { embedder, llm: llmFromModel("mock:json", model), vocabulary });
    expect(model.doGenerateCalls[0]?.responseFormat?.type).toBe("json");
    expect(r.understood.queries).toContain("password reset link email");
    expect(r.understood.filters).toEqual({ status: "approved" });
  });

  it("falls back to plain search when the structured call fails", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("json mode unsupported"); } });
    const r = await smartSearch(store, "reset link valid", { embedder, llm: llmFromModel("mock:json", model), vocabulary });
    expect(r.understood.fallback).toMatch(/json mode unsupported/);
    expect(r.hits.length).toBeGreaterThan(0);
  });
});

