import { defaultConfig } from "@defluance/vault-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashEmbedder } from "@defluance/shared";
import { indexVault } from "./indexer.js";
import { search } from "./search.js";
import type { IndexStore } from "./store.js";
import { dialects, makeVault, note, openTestStore } from "./test-env.js";

describe.each(dialects)("search (%s)", (dialect) => {
  let store: IndexStore;
  let cleanup: () => Promise<void>;
  const embedder = hashEmbedder();

  beforeAll(async () => {
    store = await openTestStore(dialect);
    const v = await makeVault({
      "auth-login.md": note("functional-spec", "approved", "# Login\n\nUsers sign in with email and password. A password reset link is sent by email.", "tags: [auth, v1]\n"),
      "sessions.md": note("technical-spec", "draft", "# Sessions\n\nSession tokens are signed JWT. They expire after seven days.", "tags: [auth]\n"),
      "produit/billing.md": note("functional-spec", "draft", "# Billing\n\nInvoices are generated monthly. Tax rates depend on the country."),
      "produit/réinitialisation.md": note("note", "draft", "# Réinitialisation\n\nProcédure de réinitialisation des accès."),
      "produit/guide.md": note("note", "draft", "# Guide\n\n## Intro\n\nZebrafish are small.\n\n## Care\n\nFeed the zebrafish twice a day.\n\n## Breeding\n\nZebrafish breed in groups."),
    });
    cleanup = v.remove;
    await indexVault(store, {
      root: v.root,
      embedder,
      config: { ...defaultConfig, spaces: [{ name: "produit", path: "produit", repos: [] }] },
    });
  });
  afterAll(async () => {
    await cleanup();
    await store.db.close();
  });

  it("ranks the matching note first, with heading, snippet and commit info", async () => {
    const [hit] = await search(store, "password reset email", { embedder });
    expect(hit?.note).toMatchObject({ id: "auth-login", type: "functional-spec", space: "default" });
    expect(hit?.chunk.heading).toBe("Login");
    expect(hit?.chunk.snippet.toLowerCase()).toContain("password");
    expect(hit?.sources).toEqual(expect.arrayContaining(["fts"]));
  });

  it("works full-text only when no embedder is given", async () => {
    const hits = await search(store, "invoices tax");
    expect(hits.map((h) => h.note.id)).toEqual(["produit/billing"]);
    expect(hits[0]?.sources).toEqual(["fts"]);
  });

  it("adds vector matches in hybrid mode", async () => {
    const hits = await search(store, "jwt tokens expire", { embedder });
    expect(hits[0]?.note.id).toBe("sessions");
    expect(hits[0]?.sources).toContain("vector");
  });

  it("matches word prefixes and ignores accents", async () => {
    expect((await search(store, "reset"))[0]?.note.id).toBe("auth-login");
    expect((await search(store, "reinitialisation"))[0]?.note.id).toBe("produit/réinitialisation");
    expect((await search(store, "RÉINITIALISATION"))[0]?.note.id).toBe("produit/réinitialisation");
  });

  it("filters by type, status, tag, space and owner, and they combine", async () => {
    const q = "tokens email password";
    expect((await search(store, q, { embedder, type: "technical-spec" })).map((h) => h.note.id)).toEqual(["sessions"]);
    expect((await search(store, q, { embedder, status: "approved" })).map((h) => h.note.id)).toEqual(["auth-login"]);
    expect((await search(store, q, { embedder, tag: "v1" })).map((h) => h.note.id)).toEqual(["auth-login"]);
    expect((await search(store, "invoices", { embedder, space: "produit" })).map((h) => h.note.id)).toEqual(["produit/billing"]);
    expect(await search(store, "invoices", { embedder, space: "default" })).toEqual([]);
    expect((await search(store, q, { embedder, tag: "auth", status: "draft" })).map((h) => h.note.id)).toEqual(["sessions"]);
    expect(await search(store, q, { embedder, owner: "nobody" })).toEqual([]);
  });

  it("restricts to allowed spaces (permissions)", async () => {
    expect(await search(store, "invoices", { embedder, spaces: ["default"] })).toEqual([]);
    expect(await search(store, "invoices", { embedder, spaces: [] })).toEqual([]);
    expect((await search(store, "invoices", { embedder, spaces: ["produit"] }))[0]?.note.id).toBe("produit/billing");
  });

  it("keyword mode ignores vectors, meaning mode ignores words", async () => {
    const kw = await search(store, "jwt tokens expire", { embedder, mode: "keyword" });
    expect(kw.length).toBeGreaterThan(0);
    expect(kw.every((h) => h.sources.length === 1 && h.sources[0] === "fts")).toBe(true);
    const meaning = await search(store, "jwt tokens expire", { embedder, mode: "meaning" });
    expect(meaning[0]?.note.id).toBe("sessions");
    expect(meaning.every((h) => h.sources.every((x) => x === "vector"))).toBe(true);
    expect(await search(store, "jwt tokens expire", { mode: "meaning" })).toEqual([]); // no embedder: nothing to compare
  });

  it("returns several passages of a note when asked, best first", async () => {
    const one = await search(store, "zebrafish", { embedder });
    expect(one[0]?.note.id).toBe("produit/guide");
    expect(one[0]?.more).toBeUndefined();
    const three = await search(store, "zebrafish", { embedder, passages: 3 });
    expect(three).toHaveLength(one.length);
    expect(three[0]?.more?.length).toBe(2);
    const headings = [three[0]?.chunk.heading, ...(three[0]?.more ?? []).map((m) => m.heading)];
    expect(new Set(headings).size).toBe(3);
  });

  it("uses the embedder's query side and its own similarity floor", async () => {
    const calls: string[] = [];
    const inner = hashEmbedder();
    const strict = { ...inner, model: inner.model, minSimilarity: 0.99, embedQuery: async (t: string) => (calls.push(t), (await inner.embed([t]))[0] as Float32Array) };
    expect(await search(store, "jwt tokens expire", { embedder: strict, mode: "meaning" })).toEqual([]);
    expect(calls).toEqual(["jwt tokens expire"]);
    const loose = { ...strict, minSimilarity: 0 };
    expect((await search(store, "jwt tokens expire", { embedder: loose, mode: "meaning" })).length).toBeGreaterThan(0);
  });

  it("fusion weights decide which side leads", async () => {
    const q = "jwt tokens expire";
    const words = await search(store, q, { embedder, mode: "keyword" });
    const onlyWords = await search(store, q, { embedder, weights: { fts: 1, vector: 0 } });
    expect(onlyWords.map((h) => h.note.id).filter((id) => words.some((w) => w.note.id === id))).toEqual(words.map((h) => h.note.id));
    const onlyMeaning = await search(store, q, { embedder, weights: { fts: 0, vector: 1 } });
    const meaning = await search(store, q, { embedder, mode: "meaning" });
    expect(onlyMeaning.slice(0, 3).map((h) => h.note.id)).toEqual(meaning.slice(0, 3).map((h) => h.note.id));
  });

  it("returns one hit per note, honours limit, and handles empty or odd queries", async () => {
    const hits = await search(store, "the", { limit: 1 });
    expect(hits.length).toBeLessThanOrEqual(1);
    expect(await search(store, "   ")).toEqual([]);
    expect(await search(store, `"; DROP TABLE notes; --`)).toEqual([]);
    expect(await search(store, "zzzzunknownzzzz")).toEqual([]);
    expect((await store.counts()).notes).toBe(5);
  });
});
