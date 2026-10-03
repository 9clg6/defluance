import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IndexStore, indexVault, openSqlite } from "@defluance/indexer";
import { hashEmbedder, type Embedder } from "@defluance/shared";
import { createLocalEmbedder } from "./local-embedder.js";
import { evaluateSearch, parseQuestions } from "./eval.js";

const VAULT = fileURLToPath(new URL("../../../fixtures/vault-semantic", import.meta.url));

async function measure(embedder: Embedder, mode: "keyword" | "meaning" | "hybrid") {
  const store = await IndexStore.open(openSqlite(":memory:"));
  await indexVault(store, { root: VAULT, embedder, deferEmbeddings: false });
  const questions = parseQuestions(await readFile(`${VAULT}/questions.yaml`, "utf8"));
  const report = await evaluateSearch(store, questions, { embedder, mode });
  await store.db.close();
  return report;
}

describe("search quality, offline baseline", () => {
  it("the word-matching embedder keeps its measured quality (guards against regressions)", async () => {
    const hybrid = await measure(hashEmbedder(), "hybrid");
    const keyword = await measure(hashEmbedder(), "keyword");
    expect(hybrid.total).toBe(28);
    expect(hybrid.recallAt3).toBeGreaterThanOrEqual(0.7);
    expect(hybrid.mrr).toBeGreaterThanOrEqual(0.6);
    // exact-term queries are found by words, whatever the embedder
    expect(keyword.misses.filter((m) => /^(status 429|PDF billing|six times|free month|thirty days|refresh token)/.test(m.q))).toEqual([]);
  });
});

// Needs the real model (about 600 MB, downloaded once). Run with:
//   DFL_TEST_LOCAL=1 DFL_RUNTIME_DIR=... DFL_MODEL_CACHE=... pnpm --filter @defluance/ai test
describe.skipIf(!process.env["DFL_TEST_LOCAL"])("search quality with the local multilingual model", () => {
  const embedder = createLocalEmbedder(undefined, { autoInstall: false, log: () => undefined });

  it("finds paraphrases, across languages, far better than words alone", async () => {
    const words = await measure(hashEmbedder(), "keyword");
    const meaning = await measure(embedder, "meaning");
    expect(meaning.recallAt1).toBeGreaterThanOrEqual(0.88);
    expect(meaning.recallAt3).toBeGreaterThanOrEqual(0.92);
    expect(meaning.mrr).toBeGreaterThanOrEqual(0.9);
    expect(meaning.recallAt1).toBeGreaterThan(words.recallAt1 + 0.2);
  }, 120_000);

  it("hybrid keeps the gain and never loses an exact-term query", async () => {
    const hybrid = await measure(embedder, "hybrid");
    expect(hybrid.recallAt3).toBeGreaterThanOrEqual(0.92);
    expect(hybrid.mrr).toBeGreaterThanOrEqual(0.88);
    expect(hybrid.misses.filter((m) => /^(status 429|PDF billing|six times|free month|thirty days|refresh token)/.test(m.q))).toEqual([]);
  }, 120_000);
});
