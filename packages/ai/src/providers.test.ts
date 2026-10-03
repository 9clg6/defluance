import { describe, expect, it } from "vitest";
import { cosine } from "@defluance/shared";
import { createEmbedder, createLlm, parseSpec, providersFromEnv } from "./providers.js";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("specs", () => {
  it("parses provider:model, keeping colons in the model name", () => {
    expect(parseSpec("ollama:nomic-embed-text:latest")).toEqual({ provider: "ollama", model: "nomic-embed-text:latest" });
    expect(parseSpec("hash")).toEqual({ provider: "hash", model: "" });
  });
});

describe("createEmbedder", () => {
  it("defaults to the offline hash embedder", async () => {
    expect(createEmbedder(undefined).model).toBe("hash-512");
    expect(createEmbedder("hash:64").model).toBe("hash-64");
    expect((await createEmbedder("hash:64").embed(["x"]))[0]).toHaveLength(64);
  });

  it("calls an OpenAI-compatible endpoint (Ollama) and normalises vectors", async () => {
    const seen: { url: string; body: { model: string; input: string[] } }[] = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return json({
        object: "list",
        model: "nomic",
        data: [{ object: "embedding", index: 0, embedding: [3, 4] }, { object: "embedding", index: 1, embedding: [0, 2] }],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      });
    }) as typeof fetch;
    const e = createEmbedder("ollama:nomic", { env: {}, fetch: fetchMock });
    const [a, b] = await e.embed(["one", "two"]);
    expect(seen[0]?.url).toBe("http://localhost:11434/v1/embeddings");
    expect(seen[0]?.body).toMatchObject({ model: "nomic", input: ["one", "two"] });
    expect(e.model).toBe("ollama:nomic");
    expect(Array.from(a as Float32Array)).toEqual([expect.closeTo(0.6), expect.closeTo(0.8)]);
    expect(cosine(b as Float32Array, b as Float32Array)).toBeCloseTo(1);
  });

  it("fails clearly on missing configuration or unknown specs", () => {
    expect(() => createEmbedder("openai:text-embedding-3-small", { env: {} })).toThrow(/OPENAI_API_KEY/);
    expect(() => createEmbedder("openai-compatible:m", { env: {} })).toThrow(/DFL_AI_BASE_URL/);
    expect(() => createEmbedder("magic:m", { env: {} })).toThrow(/unsupported/);
  });
});

describe("createLlm", () => {
  it("is null without a spec", () => {
    expect(createLlm(undefined)).toBeNull();
    expect(createLlm("none")).toBeNull();
  });

  it("generates text through an OpenAI-compatible chat endpoint", async () => {
    const seen: { messages: { role: string; content: string }[]; temperature: number }[] = [];
    const fetchMock = (async (_u: string | URL | Request, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)));
      return json({
        id: "1", object: "chat.completion", created: 1, model: "m",
        choices: [{ index: 0, message: { role: "assistant", content: "Hello [1]" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }) as typeof fetch;
    const llm = createLlm("openai-compatible:m", { env: { DFL_AI_BASE_URL: "http://x/v1" }, fetch: fetchMock });
    expect(await llm?.generate("be brief", "question")).toBe("Hello [1]");
    expect(seen[0]?.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(seen[0]?.temperature).toBe(0);
  });

  it("checks credentials up front", () => {
    expect(() => createLlm("anthropic:claude-sonnet-5-5", { env: {} })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => createLlm("gateway:anthropic/claude-sonnet-5-5", { env: {} })).toThrow(/AI_GATEWAY_API_KEY/);
    expect(createLlm("anthropic:claude-sonnet-5-5", { env: { ANTHROPIC_API_KEY: "k" } })?.id).toBe("anthropic:claude-sonnet-5-5");
    expect(() => createLlm("anthropic", { env: {} })).toThrow(/provider:model/);
  });
});

describe("providersFromEnv", () => {
  it("reads DFL_EMBED and DFL_LLM", () => {
    const p = providersFromEnv({ DFL_EMBED: "hash:32", DFL_LLM: "ollama:llama3" });
    expect(p.embedder.model).toBe("hash-32");
    expect(p.llm?.id).toBe("ollama:llama3");
    expect(providersFromEnv({}).llm).toBeNull();
  });
});
