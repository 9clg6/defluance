import { describe, expect, it } from "vitest";
import { cosine } from "@defluance/shared";
import { createEmbedder } from "./providers.js";
import { createLocalEmbedder, windows, type Loader } from "./local-embedder.js";

/** A fake model: 3 dimensions from letter counts, and a record of every call. */
function fakeLoader() {
  const calls: string[][] = [];
  const load: Loader = async () => async (texts) => {
    calls.push(texts);
    return texts.map((t) => {
      const v = [t.split("a").length - 1, t.split("e").length - 1, t.split("o").length - 1];
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    });
  };
  return { load, calls };
}

describe("windows", () => {
  it("keeps short text whole and cuts long text on words", () => {
    expect(windows("one two three", 5)).toEqual(["one two three"]);
    const long = Array.from({ length: 10 }, (_, i) => `w${i}`).join(" ");
    expect(windows(long, 4)).toEqual(["w0 w1 w2 w3", "w4 w5 w6 w7", "w8 w9"]);
  });
});

describe("createLocalEmbedder", () => {
  it("returns unit vectors, labelled local, flagged slow with its own similarity floor", async () => {
    const { load } = fakeLoader();
    const e = createLocalEmbedder("Org/model", { load });
    const [v] = await e.embed(["banana"]);
    expect(e.model).toBe("local:Org/model");
    expect(e.slow).toBe(true);
    expect(e.minSimilarity).toBe(0.2);
    expect(cosine(v as Float32Array, v as Float32Array)).toBeCloseTo(1, 5);
  });

  it("e5 models get the query and passage prefixes and a stricter floor", async () => {
    const { load, calls } = fakeLoader();
    const e = createLocalEmbedder("Xenova/multilingual-e5-small", { load });
    await e.embed(["a doc"]);
    await e.embedQuery?.("a question");
    expect(calls.flat()).toEqual(["passage: a doc", "query: a question"]);
    expect(e.minSimilarity).toBe(0.8);
    const plain = fakeLoader();
    await createLocalEmbedder("Org/other", { load: plain.load }).embed(["x"]);
    expect(plain.calls.flat()).toEqual(["x"]);
  });

  it("embeds long passages in pieces and averages them", async () => {
    const { load, calls } = fakeLoader();
    const e = createLocalEmbedder("Org/m", { load });
    const long = Array.from({ length: 200 }, () => "banana").join(" ");
    const [v] = await e.embed([long]);
    expect(calls.flat().length).toBeGreaterThan(1);
    expect(Math.hypot(...(v as Float32Array))).toBeCloseTo(1, 4);
  });

  it("sends texts to the model in batches of 32 and keeps the order", async () => {
    const { load, calls } = fakeLoader();
    const e = createLocalEmbedder("Org/m", { load });
    const texts = Array.from({ length: 70 }, (_, i) => `${"a".repeat(i % 5)}${"e".repeat((i + 1) % 4)}x`);
    const out = await e.embed(texts);
    expect(out).toHaveLength(70);
    expect(calls.map((c) => c.length)).toEqual([32, 32, 6]);
    const single = await createLocalEmbedder("Org/m", { load: fakeLoader().load }).embed([texts[40] as string]);
    expect(Array.from(out[40] as Float32Array)).toEqual(Array.from(single[0] as Float32Array));
  });

  it("serialises concurrent calls and loads the model once", async () => {
    let loads = 0;
    let running = 0;
    let peak = 0;
    const load: Loader = async () => {
      loads++;
      return async (texts) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return texts.map(() => [1, 0, 0]);
      };
    };
    const e = createLocalEmbedder("Org/m", { load });
    await Promise.all([e.embed(["a"]), e.embed(["b"]), e.embedQuery?.("c")]);
    expect(loads).toBe(1);
    expect(peak).toBe(1);
  });

  it("explains how to install the runtime when it is missing", async () => {
    const e = createLocalEmbedder("Org/m", { runtimeDir: "/nonexistent/defluance-runtime", autoInstall: false });
    await expect(e.embed(["x"])).rejects.toThrow(/defluance models install/);
  });

  it("a failed load can be retried by the next call", async () => {
    let attempt = 0;
    const load: Loader = async () => {
      if (++attempt === 1) throw new Error("download failed");
      return async (t) => t.map(() => [1, 0, 0]);
    };
    const e = createLocalEmbedder("Org/m", { load });
    await expect(e.embed(["x"])).rejects.toThrow("download failed");
    await expect(e.embed(["x"])).resolves.toHaveLength(1);
    expect(attempt).toBe(2);
  });
});

describe("createEmbedder spec", () => {
  it("`local` and `local:<model>` build local embedders", () => {
    expect(createEmbedder("local", { local: { load: fakeLoader().load } }).model).toBe("local:Xenova/paraphrase-multilingual-MiniLM-L12-v2");
    expect(createEmbedder("local:Org/m", { local: { load: fakeLoader().load } }).model).toBe("local:Org/m");
  });
});
