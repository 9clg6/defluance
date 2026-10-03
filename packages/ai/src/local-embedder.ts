import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Embedder } from "@defluance/shared";

/** Multilingual, 384 dimensions, ~120 MB quantised. Scores separate related text (0.4+) from unrelated (about 0). */
export const DEFAULT_LOCAL_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const RUNTIME_PACKAGE = "@huggingface/transformers";
export const RUNTIME_VERSION = "4.3.0";

export const defaultRuntimeDir = () => process.env["DFL_RUNTIME_DIR"] ?? join(homedir(), ".defluance", "runtime");
export const defaultModelDir = () => process.env["DFL_MODEL_CACHE"] ?? join(homedir(), ".defluance", "models");

/** Turns texts into unit vectors. */
export type Extractor = (texts: string[]) => Promise<number[][]>;
export type Loader = (model: string, o: { cacheDir: string; log: (m: string) => void }) => Promise<Extractor>;

export interface LocalOptions {
  runtimeDir?: string;
  cacheDir?: string;
  log?: (message: string) => void;
  /** Install the runtime on first use. Off by default: it is a ~480 MB download. */
  autoInstall?: boolean;
  /** Test hook: replaces the real model. */
  load?: Loader;
}

const BATCH = 32;

/** Entry point of the runtime: from our own dependencies, else from the on-demand install folder. */
function resolveRuntime(runtimeDir: string): string | null {
  for (const base of [import.meta.url, pathToFileURL(join(runtimeDir, "noop.js")).href]) {
    try {
      return createRequire(base).resolve(RUNTIME_PACKAGE);
    } catch {
      // try the next place
    }
  }
  return null;
}

/** `npm install` into a private folder, so the 480 MB runtime is only paid for by people who ask for local models. */
export async function installRuntime(runtimeDir: string, log: (m: string) => void): Promise<void> {
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(join(runtimeDir, "package.json"), '{"name":"defluance-runtime","private":true}\n');
  log(`installing ${RUNTIME_PACKAGE}@${RUNTIME_VERSION} into ${runtimeDir} (about 480 MB, once)`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn("npm", ["install", `${RUNTIME_PACKAGE}@${RUNTIME_VERSION}`, "--prefix", runtimeDir, "--no-audit", "--no-fund", "--loglevel=error"], { stdio: ["ignore", "inherit", "inherit"] });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`npm install exited with code ${code}`))));
  });
}

const realLoader =
  (runtimeDir: string, autoInstall: boolean): Loader =>
  async (model, { cacheDir, log }) => {
    let entry = resolveRuntime(runtimeDir);
    if (!entry && autoInstall) {
      await installRuntime(runtimeDir, log);
      entry = resolveRuntime(runtimeDir);
    }
    if (!entry) throw new Error(`Local models need ${RUNTIME_PACKAGE}. Run \`defluance models install\` once (about 480 MB), then restart.`);
    const tf = (await import(pathToFileURL(entry).href)) as {
      env: { cacheDir: string };
      pipeline: (task: string, model: string, o: object) => Promise<(t: string[], o: object) => Promise<{ tolist(): number[][] }>>;
    };
    tf.env.cacheDir = cacheDir;
    let lastLogged = -1;
    const extractor = await tf.pipeline("feature-extraction", model, {
      dtype: "q8",
      progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
        if (p.status === "progress" && typeof p.progress === "number" && p.file?.endsWith(".onnx")) {
          const step = Math.floor(p.progress / 20) * 20;
          if (step > lastLogged) {
            lastLogged = step;
            log(`downloading ${model}: ${step}%`);
          }
        }
      },
    });
    return async (texts) => (await extractor(texts, { pooling: "mean", normalize: true })).tolist();
  };

/** Split on words into windows: these models read 128 to 512 tokens, a longer passage would be cut off silently. */
export function windows(text: string, maxWords: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [text];
  const out: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) out.push(words.slice(i, i + maxWords).join(" "));
  return out;
}

function unit(v: number[]): Float32Array {
  const f = Float32Array.from(v);
  let n = 0;
  for (const x of f) n += x * x;
  n = Math.sqrt(n) || 1;
  return f.map((x) => x / n);
}

/**
 * Semantic embeddings computed on this machine: no service, no key, the text never leaves it.
 * Passages longer than the model's window are embedded in pieces and averaged.
 */
export function createLocalEmbedder(model: string = DEFAULT_LOCAL_MODEL, o: LocalOptions = {}): Embedder {
  const e5 = /e5/i.test(model);
  const prefix = e5 ? { query: "query: ", passage: "passage: " } : { query: "", passage: "" };
  const maxWords = e5 ? 280 : 85;
  const log = o.log ?? ((m: string) => console.error(`[defluance] ${m}`));
  const loader = o.load ?? realLoader(o.runtimeDir ?? defaultRuntimeDir(), o.autoInstall ?? false);
  let extractor: Promise<Extractor> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  // One inference at a time: the runtime is not meant for concurrent calls, and it keeps memory flat.
  const run = (texts: string[]): Promise<number[][]> => {
    const next = queue.then(async () => {
      extractor ??= loader(model, { cacheDir: o.cacheDir ?? defaultModelDir(), log });
      try {
        return await (await extractor)(texts);
      } catch (e) {
        extractor = undefined; // a failed download or load must not stick: the next call tries again
        throw e;
      }
    });
    queue = next.catch(() => undefined);
    return next;
  };

  const embedAll = async (texts: string[], pre: string): Promise<Float32Array[]> => {
    const pieces: { text: string; owner: number }[] = [];
    texts.forEach((t, i) => windows(t, maxWords).forEach((w) => pieces.push({ text: pre + w, owner: i })));
    const vectors: number[][] = [];
    for (let i = 0; i < pieces.length; i += BATCH) vectors.push(...(await run(pieces.slice(i, i + BATCH).map((p) => p.text))));
    const sums = texts.map(() => null as number[] | null);
    pieces.forEach((p, i) => {
      const v = vectors[i] as number[];
      const acc = sums[p.owner];
      if (!acc) sums[p.owner] = [...v];
      else for (let k = 0; k < v.length; k++) acc[k] = (acc[k] as number) + (v[k] as number);
    });
    return sums.map((s) => unit(s as number[]));
  };

  return {
    model: `local:${model}`,
    slow: true,
    semantic: true,
    minSimilarity: e5 ? 0.8 : 0.2,
    embed: (texts) => embedAll(texts, prefix.passage),
    async embedQuery(text) {
      return (await embedAll([text], prefix.query))[0] as Float32Array;
    },
  };
}
