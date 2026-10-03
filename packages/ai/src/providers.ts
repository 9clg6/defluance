import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embedMany, generateText } from "ai";
import { hashEmbedder, type Embedder } from "@defluance/shared";
import { createLocalEmbedder, type LocalOptions } from "./local-embedder.js";

export type LanguageModel = Parameters<typeof generateText>[0]["model"];

export interface Llm {
  /** `provider:model`, shown in logs and answers. */
  id: string;
  generate(system: string, prompt: string): Promise<string>;
  /** The underlying model, for features that call tools (deep search). Absent on custom implementations. */
  model?: LanguageModel;
}

export type Env = Record<string, string | undefined>;

export interface ProviderOptions {
  env?: Env;
  /** Test hook: replaces the global fetch used by the providers. */
  fetch?: typeof fetch;
  /** Options for `local` embeddings. */
  local?: LocalOptions;
}

export function parseSpec(spec: string): { provider: string; model: string } {
  const i = spec.indexOf(":");
  if (i === -1) return { provider: spec, model: "" };
  return { provider: spec.slice(0, i), model: spec.slice(i + 1) };
}

const need = (env: Env, key: string, spec: string): string => {
  const v = env[key];
  if (!v) throw new Error(`"${spec}" needs ${key} to be set`);
  return v;
};

/** Providers speaking the OpenAI wire format: OpenAI itself, Ollama, any compatible server. */
function openaiLike(provider: string, env: Env, spec: string, fetchFn?: typeof fetch) {
  const f = fetchFn ? { fetch: fetchFn } : {};
  if (provider === "openai") {
    return createOpenAI({ apiKey: need(env, "OPENAI_API_KEY", spec), ...(env["OPENAI_BASE_URL"] ? { baseURL: env["OPENAI_BASE_URL"] } : {}), ...f });
  }
  if (provider === "ollama") {
    return createOpenAICompatible({ name: "ollama", baseURL: env["OLLAMA_BASE_URL"] ?? "http://localhost:11434/v1", ...f });
  }
  if (provider === "openai-compatible") {
    return createOpenAICompatible({
      name: "openai-compatible",
      baseURL: need(env, "DFL_AI_BASE_URL", spec),
      ...(env["DFL_AI_API_KEY"] ? { apiKey: env["DFL_AI_API_KEY"] } : {}),
      ...f,
    });
  }
  return null;
}

/**
 * Embedding model from a spec: `hash[:dim]` (default: offline, matches words), `local[:<hf model>]` (meaning,
 * computed on this machine), `openai:<model>`, `ollama:<model>`, `openai-compatible:<model>` (needs DFL_AI_BASE_URL).
 */
export function createEmbedder(spec: string | undefined, opts: ProviderOptions = {}): Embedder {
  const env = opts.env ?? process.env;
  if (!spec || spec === "hash" || spec.startsWith("hash:")) {
    const dim = Number(spec?.split(":")[1]) || 512;
    return hashEmbedder(dim);
  }
  const { provider, model } = parseSpec(spec);
  if (provider === "local") return createLocalEmbedder(model || undefined, { autoInstall: true, ...(opts.local ?? {}) });
  const p = openaiLike(provider, env, spec, opts.fetch);
  if (!p || !model) throw new Error(`unsupported embedding spec "${spec}" (use hash, local, openai:<model>, ollama:<model> or openai-compatible:<model>)`);
  const m = p.embeddingModel(model);
  return {
    model: spec,
    semantic: true,
    slow: true,
    async embed(texts) {
      const { embeddings } = await embedMany({ model: m, values: texts });
      return embeddings.map((e) => {
        const v = Float32Array.from(e);
        let n = 0;
        for (const x of v) n += x * x;
        n = Math.sqrt(n) || 1;
        return v.map((x) => x / n); // cosine() assumes unit vectors
      });
    },
  };
}

/**
 * Language model from a spec: `anthropic:<model>`, `openai:<model>`, `ollama:<model>`, `openai-compatible:<model>`,
 * `gateway:<provider/model>` (Vercel AI Gateway, needs AI_GATEWAY_API_KEY). Undefined: no LLM, answers are extractive.
 */
export function createLlm(spec: string | undefined, opts: ProviderOptions = {}): Llm | null {
  if (!spec || spec === "none") return null;
  const env = opts.env ?? process.env;
  const { provider, model } = parseSpec(spec);
  if (!model) throw new Error(`unsupported LLM spec "${spec}" (expected provider:model)`);

  let languageModel: Parameters<typeof generateText>[0]["model"];
  if (provider === "anthropic") {
    const a = createAnthropic({ apiKey: need(env, "ANTHROPIC_API_KEY", spec), ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    languageModel = a(model);
  } else if (provider === "gateway") {
    need(env, "AI_GATEWAY_API_KEY", spec);
    languageModel = model; // plain "provider/model" string routed through the AI Gateway
  } else {
    const p = openaiLike(provider, env, spec, opts.fetch);
    if (!p) throw new Error(`unsupported LLM provider "${provider}"`);
    languageModel = p.languageModel(model);
  }
  return {
    id: spec,
    model: languageModel,
    async generate(system, prompt) {
      const { text } = await generateText({ model: languageModel, system, prompt, temperature: 0, maxRetries: 2 });
      return text;
    },
  };
}

/** `DFL_EMBED` and `DFL_LLM` environment variables. */
export function providersFromEnv(env: Env = process.env, opts: Omit<ProviderOptions, "env"> = {}) {
  return { embedder: createEmbedder(env["DFL_EMBED"], { ...opts, env }), llm: createLlm(env["DFL_LLM"], { ...opts, env }) };
}
