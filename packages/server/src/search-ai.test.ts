import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Llm } from "@defluance/ai";
import { hashEmbedder, type Embedder } from "@defluance/shared";
import { startBackfill } from "./context.js";
import { makeServer, type TestServer } from "./test-env.js";

const enc = encodeURIComponent;
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const toolCall = (toolName: string, input: object) => ({ content: [{ type: "tool-call" as const, toolCallId: crypto.randomUUID(), toolName, input: JSON.stringify(input) }], finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [] });
const say = (text: string) => ({ content: [{ type: "text" as const, text }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] });

/** An LLM that plans searches, then (for deep ask) acts as a tool-calling agent. */
function scriptedLlm(plan: string): Llm {
  const model = new MockLanguageModelV4({ doGenerate: [toolCall("search", { query: "session cookies expire" }), say("Cookies expire after fifteen minutes [1].")] });
  return { id: "mock:smart", model, generate: async () => plan };
}

describe("search modes, smart search and deep ask over REST", () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await makeServer({ llm: scriptedLlm('{"queries": ["signed JWT cookies expire fifteen minutes"], "filters": {"status": "approved"}}') });
  });
  afterAll(() => s.cleanup());

  it("announces what search can do", async () => {
    const me = (await s.call("GET", "/api/v1/me")).body;
    expect(me.capabilities).toEqual({ semantic: false, embedder: "hash-512", llm: "mock:smart", deep: true, collab: true });
    const status = (await s.call("GET", "/api/v1/index/status")).body;
    expect(status.capabilities.llm).toBe("mock:smart");
    expect(status.embedding).toMatchObject({ running: false, pending: 0, error: null });
  });

  it("keyword, meaning and hybrid are separate modes", async () => {
    const kw = (await s.call("GET", "/api/v1/search?q=session+tokens+expire&mode=keyword")).body;
    expect(kw.length).toBeGreaterThan(0);
    expect(kw.every((h: { sources: string[] }) => h.sources.join() === "fts")).toBe(true);
    const meaning = (await s.call("GET", "/api/v1/search?q=session+tokens+expire&mode=meaning")).body;
    expect(meaning.every((h: { sources: string[] }) => h.sources.join() === "vector")).toBe(true);
    expect((await s.call("GET", "/api/v1/search?q=x&mode=fuzzy")).status).toBe(422);
  });

  it("returns several passages per note when asked", async () => {
    const r = (await s.call("GET", "/api/v1/search?q=users&passages=3")).body;
    expect(Array.isArray(r)).toBe(true);
    expect((await s.call("GET", "/api/v1/search?q=users&passages=9")).status).toBe(422);
  });

  it("smart search shows how the question was understood", async () => {
    const r = (await s.call("GET", `/api/v1/search/smart?q=${enc("how long do session cookies live")}&rerank=false`)).body;
    expect(r.understood.queries).toEqual(["how long do session cookies live", "signed JWT cookies expire fifteen minutes"]);
    expect(r.understood.filters).toEqual({ status: "approved" });
    expect(r.hits[0].note.id).toBe("tech/sessions");
    expect(r.hits.every((h: { note: { status: string } }) => h.note.status === "approved")).toBe(true);
  });

  it("smart search respects spaces", async () => {
    const t = await s.token(["read"], ["produit"]);
    const r = (await s.call("GET", `/api/v1/search/smart?q=${enc("session cookies")}`, { token: t })).body;
    expect(r.hits.every((h: { note: { space: string } }) => h.note.space === "produit")).toBe(true);
  });

  it("deep ask returns the steps the agent took and cites what it read", async () => {
    const r = await s.call("POST", "/api/v1/ask", { body: { question: "How long do session cookies last?", deep: true } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: "deep", refused: false });
    expect(r.body.citations[0]).toMatchObject({ n: 1, note: "tech/sessions" });
    expect(r.body.steps).toEqual([expect.objectContaining({ tool: "search", input: "session cookies expire" })]);
    expect((await s.call("POST", "/api/v1/ask", { body: { question: "x", deep: true, max_steps: 99 } })).status).toBe(422);
  });

  it("smart search and deep ask are available to agents through MCP", async () => {
    const llm = scriptedLlm('{"queries": ["signed JWT cookies expire fifteen minutes"], "filters": {}}');
    const server = await makeServer({ llm });
    try {
      const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), { requestInit: { headers: { authorization: `Bearer ${server.admin}` } }, fetch: ((u: string | URL, i?: RequestInit) => server.request(String(u), i)) as typeof fetch });
      const client = new Client({ name: "t", version: "1" });
      await client.connect(transport as never);
      const json = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content[0] as { text: string }).text);
      const smart = json(await client.callTool({ name: "search", arguments: { query: "how long do cookies live", mode: "smart" } }));
      expect(smart.understood.queries).toContain("signed JWT cookies expire fifteen minutes");
      expect(smart.hits[0].note.id).toBe("tech/sessions");
      const deep = json(await client.callTool({ name: "ask", arguments: { question: "How long do session cookies last?", deep: true } }));
      expect(deep.mode).toBe("deep");
      expect(deep.steps[0].tool).toBe("search");
      const kw = json(await client.callTool({ name: "search", arguments: { query: "session tokens", mode: "keyword" } }));
      expect(Array.isArray(kw)).toBe(true);
      await client.close();
    } finally {
      await server.cleanup();
    }
  });
});

describe("without a language model", () => {
  it("smart search degrades to hybrid and says why; deep ask degrades to a normal answer", async () => {
    const s = await makeServer();
    try {
      const r = (await s.call("GET", `/api/v1/search/smart?q=${enc("session cookies expire")}`)).body;
      expect(r.understood.fallback).toMatch(/no language model/);
      expect(r.hits[0].note.id).toBe("tech/sessions");
      const a = (await s.call("POST", "/api/v1/ask", { body: { question: "How long do session cookies last?", deep: true } })).body;
      expect(a.mode).toBe("extractive");
      expect((await s.call("GET", "/api/v1/me")).body.capabilities).toMatchObject({ llm: null, deep: false });
    } finally {
      await s.cleanup();
    }
  });
});

describe("vectors computed in the background", () => {
  const delayed = (opts: { failFirst?: boolean } = {}): Embedder & { failing: boolean } => {
    const inner = hashEmbedder(128);
    const e = {
      model: "local:test-model",
      slow: true,
      minSimilarity: 0.1,
      failing: !!opts.failFirst,
      async embed(texts: string[]) {
        await new Promise((r) => setTimeout(r, 30));
        if (e.failing) throw new Error("model download failed");
        return inner.embed(texts);
      },
    };
    return e;
  };

  it("text is searchable at once, meaning search follows as vectors arrive, and the status shows progress", async () => {
    const s = await makeServer({ embedder: delayed() });
    try {
      // right after start: words work, vectors are on their way
      const early = (await s.call("GET", "/api/v1/index/status")).body;
      expect(early.embedding.running).toBe(true);
      expect(early.embedding.pending).toBeGreaterThan(0);
      expect(early.capabilities.semantic).toBe(true);
      expect(((await s.call("GET", "/api/v1/search?q=sessions&mode=keyword")).body as unknown[]).length).toBeGreaterThan(0);
      expect(((await s.call("GET", "/api/v1/search?q=sessions&mode=meaning")).body as unknown[]).length).toBe(0);

      await s.ctx.embeddingDone;
      const done = (await s.call("GET", "/api/v1/index/status")).body;
      expect(done.embedding).toMatchObject({ running: false, pending: 0, error: null });
      expect(done.embedded).toBe(done.chunks);
      expect(((await s.call("GET", "/api/v1/search?q=session+cookies+expire&mode=meaning")).body as { note: { id: string } }[])[0]?.note.id).toBe("tech/sessions");
      expect(await (await s.request("/metrics")).text()).toContain("defluance_embeddings_pending 0");
    } finally {
      await s.cleanup();
    }
  });

  it("a new note is findable by words immediately and by meaning after its vector is computed", async () => {
    const s = await makeServer({ embedder: delayed() });
    try {
      await s.ctx.embeddingDone;
      await s.call("POST", "/api/v1/notes", { body: { type: "note", title: "Zanzibar", body: "Zanzibar spices export.", id: "produit/zanzibar" } });
      expect(((await s.call("GET", "/api/v1/search?q=zanzibar&mode=keyword")).body as { note: { id: string } }[])[0]?.note.id).toBe("produit/zanzibar");
      expect((await s.call("GET", "/api/v1/index/status")).body.embedding.pending).toBeGreaterThan(0);
      await s.ctx.embeddingDone;
      expect((await s.call("GET", "/api/v1/index/status")).body.embedding.pending).toBe(0);
    } finally {
      await s.cleanup();
    }
  });

  it("a failing model is reported, keeps keyword search working, and recovers on retry", async () => {
    const e = delayed({ failFirst: true });
    const s = await makeServer({ embedder: e });
    try {
      await s.ctx.embeddingDone;
      const failed = (await s.call("GET", "/api/v1/index/status")).body;
      expect(failed.embedding).toMatchObject({ running: false, error: "model download failed" });
      expect(failed.embedding.pending).toBeGreaterThan(0);
      expect(((await s.call("GET", "/api/v1/search?q=sessions")).body as unknown[]).length).toBeGreaterThan(0);

      e.failing = false;
      startBackfill(s.ctx);
      await s.ctx.embeddingDone;
      expect((await s.call("GET", "/api/v1/index/status")).body.embedding).toMatchObject({ pending: 0, error: null });
    } finally {
      await s.cleanup();
    }
  });
});
