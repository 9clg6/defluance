import { defaultConfig } from "@defluance/vault-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { hashEmbedder, type Embedder } from "@defluance/shared";
import { indexVault } from "./indexer.js";
import type { IndexStore } from "./store.js";
import { dialects, makeVault, note, openTestStore, resetStore } from "./test-env.js";

describe.each(dialects)("indexVault (%s)", (dialect) => {
  let store: IndexStore;
  const vaults: { remove(): Promise<void> }[] = [];
  beforeAll(async () => {
    store = await openTestStore(dialect);
  });
  afterEach(async () => {
    await resetStore(store);
    await Promise.all(vaults.splice(0).map((v) => v.remove()));
  });
  afterAll(() => store.db.close());

  const vault = async (files: Record<string, string>) => {
    const v = await makeVault(files);
    vaults.push(v);
    return v;
  };

  it("indexes notes, chunks and resolved edges", async () => {
    const v = await vault({
      "a.md": note("functional-spec", "approved", "# A\n\nlogin flow [[b|depends_on]] and [[missing]]\n\n## Detail\n\nmore", "tags: [auth]\n"),
      "b.md": note("technical-spec", "draft", "# B\n\nsession tokens"),
    });
    const r = await indexVault(store, { root: v.root, embedder: hashEmbedder(), commit: "abc123" });
    expect(r).toMatchObject({ added: 2, updated: 0, removed: 0, unchanged: 0, full: true });
    const counts = await store.counts();
    expect(counts).toMatchObject({ notes: 2, edges: 2, embedded: counts.chunks });
    expect(counts.chunks).toBe(3);

    const a = await store.getNote("a");
    expect(a).toMatchObject({ type: "functional-spec", status: "approved", owner: "ana", tags: ["auth"], commit_sha: "abc123", space: "default" });
    const edges = await store.edgesFrom("a");
    expect(edges.map((e) => [e.to_ref, e.link_type, e.to_note])).toEqual([
      ["b", "depends_on", "b"],
      ["missing", "related", null],
    ]);
    expect((await store.edgesTo("b")).map((e) => e.from_note)).toEqual(["a"]);
  });

  it("skips unchanged notes, updates changed ones and removes deleted ones", async () => {
    const v = await vault({ "a.md": note("note", "draft", "one"), "b.md": note("note", "draft", "two") });
    await indexVault(store, { root: v.root });
    expect(await indexVault(store, { root: v.root })).toMatchObject({ unchanged: 2, added: 0, updated: 0 });

    await v.write("a.md", note("note", "approved", "one changed"));
    await v.write("c.md", note("note", "draft", "three"));
    const { rm } = await import("node:fs/promises");
    await rm(`${v.root}/b.md`);
    const r = await indexVault(store, { root: v.root });
    expect(r).toMatchObject({ added: 1, updated: 1, removed: 1, unchanged: 0 });
    expect((await store.getNote("a"))?.status).toBe("approved");
    expect(await store.getNote("b")).toBeUndefined();
    expect((await store.counts()).chunks).toBe(2);
  });

  it("re-resolves links of unchanged notes when targets appear or disappear", async () => {
    const v = await vault({ "a.md": note("note", "draft", "[[later]]") });
    await indexVault(store, { root: v.root });
    expect((await store.edgesFrom("a"))[0]?.to_note).toBeNull();
    await v.write("later.md", note("note", "draft", "x"));
    await indexVault(store, { root: v.root });
    expect((await store.edgesFrom("a"))[0]?.to_note).toBe("later");
    const { rm } = await import("node:fs/promises");
    await rm(`${v.root}/later.md`);
    await indexVault(store, { root: v.root });
    expect((await store.edgesFrom("a"))[0]?.to_note).toBeNull();
  });

  it("indexes only the given paths, and removes missing ones", async () => {
    const v = await vault({ "a.md": note("note", "draft", "one"), "b.md": note("note", "draft", "two") });
    await indexVault(store, { root: v.root });
    await v.write("a.md", note("note", "draft", "one v2"));
    await v.write("b.md", note("note", "draft", "two v2")); // not listed: must stay stale
    const r = await indexVault(store, { root: v.root, paths: ["a.md"] });
    expect(r).toMatchObject({ updated: 1, full: false });
    const rows = await store.db.all<{ content: string }>("SELECT content FROM chunks ORDER BY note_id");
    expect(rows.map((x) => x.content)).toEqual(["one v2", "two"]);

    const { rm } = await import("node:fs/promises");
    await rm(`${v.root}/a.md`);
    expect(await indexVault(store, { root: v.root, paths: ["a.md"] })).toMatchObject({ removed: 1 });
    expect(await store.getNote("a")).toBeUndefined();
  });

  it("caches embeddings by content and re-embeds when the model changes", async () => {
    const calls: string[][] = [];
    const counting = (model: string): Embedder => {
      const inner = hashEmbedder(64);
      return { model, embed: (t) => (calls.push(t), inner.embed(t)) };
    };
    const same = "title: Same\n";
    const v = await vault({ "a.md": note("note", "draft", "alpha beta"), "b.md": note("note", "draft", "gamma", same) });

    await indexVault(store, { root: v.root, embedder: counting("m1") });
    expect(calls.flat()).toHaveLength(2);

    await v.write("a.md", note("note", "draft", "alpha beta")); // same content: nothing to do
    calls.length = 0;
    expect(await indexVault(store, { root: v.root, embedder: counting("m1") })).toMatchObject({ unchanged: 2, embedded: 0 });
    expect(calls).toHaveLength(0);

    // identical chunk text in a new note: served from the cache
    await v.write("c.md", note("note", "draft", "gamma", same));
    const added = await indexVault(store, { root: v.root, embedder: counting("m1") });
    expect(added).toMatchObject({ added: 1, cacheHits: 1, embedded: 0 });

    // new model: everything re-embedded, nothing reused
    calls.length = 0;
    const r = await indexVault(store, { root: v.root, embedder: counting("m2") });
    expect(r).toMatchObject({ full: true, embedded: 2 }); // a+b distinct, c shares b's title and text
    expect(await store.getMeta("embed_model")).toBe("m2");
    expect((await store.counts()).embedded).toBe(3);
  });

  it("sets spaces from config", async () => {
    const v = await vault({ "produit/a.md": note("note", "draft", "x"), "b.md": note("note", "draft", "y") });
    await indexVault(store, { root: v.root, config: { ...defaultConfig, spaces: [{ name: "produit", path: "produit", repos: [] }] } });
    expect((await store.getNote("produit/a"))?.space).toBe("produit");
    expect((await store.getNote("b"))?.space).toBe("default");
  });

  it("ignores dot folders and non markdown files", async () => {
    const v = await vault({ "a.md": note("note", "draft", "x"), ".obsidian/x.md": "# hidden", "img.png": "x" });
    await indexVault(store, { root: v.root });
    expect((await store.counts()).notes).toBe(1);
  });
});
