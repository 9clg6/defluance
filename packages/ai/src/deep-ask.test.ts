import { fileURLToPath } from "node:url";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IndexStore, indexVault, openSqlite } from "@defluance/indexer";
import { hashEmbedder } from "@defluance/shared";
import { NO_SOURCE } from "./ask.js";
import { deepAsk } from "./deep-ask.js";
import type { Llm } from "./providers.js";

const VAULT = fileURLToPath(new URL("../../../fixtures/vault-eval", import.meta.url));
const embedder = hashEmbedder();
let store: IndexStore;

beforeAll(async () => {
  store = await IndexStore.open(openSqlite(":memory:"));
  await indexVault(store, { root: VAULT, embedder });
});
afterAll(() => store.db.close());

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const call = (toolName: string, input: object) => ({ content: [{ type: "tool-call" as const, toolCallId: crypto.randomUUID(), toolName, input: JSON.stringify(input) }], finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [] });
const say = (text: string) => ({ content: [{ type: "text" as const, text }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] });

function agent(...script: ReturnType<typeof call | typeof say>[]) {
  const model = new MockLanguageModelV4({ doGenerate: script });
  const llm: Llm = { id: "mock:agent", model, generate: async () => "" };
  return { model, llm };
}
const promptText = (m: MockLanguageModelV4, i: number) => JSON.stringify(m.doGenerateCalls[i]?.prompt);

describe("deepAsk", () => {
  it("searches, reads, follows links, then answers with citations to the passages it was given", async () => {
    const { model, llm } = agent(
      call("search", { query: "password reset link valid" }),
      call("read_note", { id: "password-reset" }),
      call("neighbors", { id: "auth-login" }),
      say("The reset link is valid for one hour [1], and a reset closes every session [2]."),
    );
    const r = await deepAsk(store, "How long is a reset link valid and what happens to sessions?", { embedder, llm });
    expect(r).toMatchObject({ refused: false, mode: "deep" });
    expect(r.citations).toHaveLength(2);
    expect(r.citations[0]).toMatchObject({ n: 1, note: "password-reset", title: "Password reset" });
    expect(r.citations[1]?.n).toBe(2);
    expect(r.answer).toContain("[1]");
    expect(r.steps?.map((s) => s.tool)).toEqual(["search", "read_note", "neighbors"]);
    expect(r.steps?.[1]).toMatchObject({ input: "password-reset", summary: "Password reset" });
    // the tool results travel back to the model with their numbers
    expect(promptText(model, 1)).toContain("[1] Password reset");
    expect(promptText(model, 2)).toContain("valid for one hour");
    expect(promptText(model, 3)).toContain("sessions");
    expect(model.doGenerateCalls).toHaveLength(4);
  });

  it("removes numbers the tools never returned, and refuses an answer with no valid citation", async () => {
    const a = await deepAsk(store, "q", { embedder, llm: agent(call("search", { query: "password reset" }), say("One hour [1] and also this [99].")).llm });
    expect(a.answer).toBe("One hour [1] and also this.");
    expect(a.citations.map((c) => c.n)).toEqual([1]);
    const b = await deepAsk(store, "q", { embedder, llm: agent(call("search", { query: "password reset" }), say("One hour [42].")).llm });
    expect(b).toMatchObject({ refused: true, answer: NO_SOURCE, mode: "deep" });
    const c = await deepAsk(store, "q", { embedder, llm: agent(say("From memory: one hour.")).llm });
    expect(c.refused).toBe(true);
  });

  it("refuses when the agent says there is no source", async () => {
    const r = await deepAsk(store, "What is the airspeed of a swallow?", { embedder, llm: agent(call("search", { query: "swallow" }), say("NO_SOURCE")).llm });
    expect(r).toMatchObject({ refused: true, citations: [] });
    expect(r.steps?.[0]).toMatchObject({ tool: "search", summary: "0 passages" });
  });

  it("the last round cannot call tools: the agent must answer", async () => {
    const { model, llm } = agent(call("search", { query: "invoice" }), say("Monthly [1]."));
    await deepAsk(store, "When are invoices generated?", { embedder, llm, maxSteps: 2 });
    expect(model.doGenerateCalls[0]?.toolChoice?.type).not.toBe("none");
    expect(model.doGenerateCalls[1]?.toolChoice?.type).toBe("none");
  });

  it("tools cannot reach notes outside the caller's spaces or scope", async () => {
    const { model, llm } = agent(call("read_note", { id: "password-reset" }), call("neighbors", { id: "auth-login" }), call("search", { query: "password reset" }), say("NO_SOURCE"));
    const r = await deepAsk(store, "q", { embedder, llm, spaces: [] });
    expect(r.refused).toBe(true);
    expect(promptText(model, 1)).toContain("No such note.");
    expect(promptText(model, 1)).not.toContain("valid for one hour");
    expect(promptText(model, 3)).toContain("No matching passage.");

    const scoped = agent(call("read_note", { id: "billing-invoices" }), say("NO_SOURCE"));
    await deepAsk(store, "q", { embedder, llm: scoped.llm, ids: ["password-reset"] });
    expect(promptText(scoped.model, 1)).toContain("No such note.");
  });

  it("falls back to a normal answer without a tool-capable model, or when the model fails", async () => {
    const plain: Llm = { id: "custom", generate: async () => "x" };
    const r = await deepAsk(store, "How long is a password reset link valid?", { embedder });
    expect(r.mode).toBe("extractive");
    expect((await deepAsk(store, "How long is a password reset link valid?", { embedder, llm: plain })).mode).toBe("llm");

    const broken = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("tools not supported"); } });
    const f = await deepAsk(store, "How long is a password reset link valid?", { embedder, llm: { id: "m", model: broken, generate: async () => "One hour [1]." } });
    expect(f.mode).toBe("llm");
    expect(f.refused).toBe(false);
    expect(f.steps?.[0]).toMatchObject({ tool: "error", summary: "tools not supported" });
  });
});
