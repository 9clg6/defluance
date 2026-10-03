import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { impact, lint, neighbors, path } from "./graph.js";
import { indexVault } from "./indexer.js";
import type { IndexStore } from "./store.js";
import { dialects, makeVault, note, openTestStore } from "./test-env.js";

// checkout --depends_on--> payments --depends_on--> ledger
// refunds --implements--> payments ; payments-tests tests payments (payments --tested_by--> payments-tests)
// checkout tracked by gh:acme/app#7 ; island has no links ; ghost link is broken
const files = {
  "checkout.md": note("functional-spec", "approved", "# Checkout\n\n[[payments|depends_on]] and [[gh:acme/app#7|tracked_by]]"),
  "payments.md": note("technical-spec", "approved", "# Payments\n\n[[ledger|depends_on]] [[payments-tests|tested_by]] [[ghost]]"),
  "ledger.md": note("technical-spec", "draft", "# Ledger\n\nbase"),
  "refunds.md": note("functional-spec", "draft", "# Refunds\n\n[[payments|implements]]"),
  "payments-tests.md": note("note", "draft", "# Tests"),
  "island.md": note("note", "draft", "# Island"),
  "secret/hidden.md": note("note", "draft", "[[checkout]]"),
};

describe.each(dialects)("graph (%s)", (dialect) => {
  let store: IndexStore;
  let cleanup: () => Promise<void>;
  const cfg = { spaces: [{ name: "secret", path: "secret", repos: [] }], repos: [], agentWriteMode: "branch" as const };

  beforeAll(async () => {
    store = await openTestStore(dialect);
    const v = await makeVault(files);
    cleanup = v.remove;
    await indexVault(store, { root: v.root, config: cfg });
    await store.upsertGhNode({
      key: "acme/app#7", kind: "issue", state: "open", title: "Checkout epic", labels: [], author: "ana",
      files: [], merged_at: null, url: "https://github.com/acme/app/issues/7", updated_at: new Date().toISOString(),
    });
  });
  afterAll(async () => {
    await cleanup();
    await store.db.close();
  });

  const ids = (g: { nodes: { id: string }[] }) => g.nodes.map((n) => n.id).sort();

  it("neighbors by direction, link type and depth", async () => {
    expect(ids(await neighbors(store, "payments", { direction: "in" }))).toEqual(["checkout", "payments", "refunds"]);
    expect(ids(await neighbors(store, "payments", { direction: "out" }))).toEqual(["ledger", "payments", "payments-tests"]);
    expect(ids(await neighbors(store, "payments", { direction: "in", link: "depends_on" }))).toEqual(["checkout", "payments"]);
    expect(ids(await neighbors(store, "ledger", { direction: "in", depth: 1 }))).toEqual(["ledger", "payments"]);
    const deep = await neighbors(store, "ledger", { direction: "in", depth: 3 });
    expect(ids(deep)).toEqual(["checkout", "ledger", "payments", "refunds", "secret/hidden"]);
    expect(deep.nodes.find((n) => n.id === "checkout")?.depth).toBe(2);
    expect(deep.edges).toContainEqual({ from: "checkout", to: "payments", type: "depends_on" });
    expect(deep.truncated).toBe(false);
  });

  it("hides notes outside the allowed spaces", async () => {
    const g = await neighbors(store, "checkout", { direction: "in", spaces: ["default"] });
    expect(ids(g)).toEqual(["checkout"]);
    expect(ids(await neighbors(store, "checkout", { direction: "in" }))).toEqual(["checkout", "secret/hidden"]);
  });

  it("finds the shortest path, undirected", async () => {
    const p = await path(store, "checkout", "ledger");
    expect(p.found).toBe(true);
    expect(p.nodes.map((n) => n.id)).toEqual(["checkout", "payments", "ledger"]);
    expect(p.edges).toEqual([
      { from: "checkout", to: "payments", type: "depends_on" },
      { from: "payments", to: "ledger", type: "depends_on" },
    ]);
    expect((await path(store, "refunds", "checkout")).nodes.map((n) => n.id)).toEqual(["refunds", "payments", "checkout"]);
    expect((await path(store, "island", "ledger")).found).toBe(false);
    expect((await path(store, "checkout", "ledger", { maxDepth: 1 })).found).toBe(false);
    expect((await path(store, "checkout", "secret/hidden", { spaces: ["default"] })).found).toBe(false);
  });

  it("impact: dependents, implementers, tests, and tracking GitHub objects", async () => {
    const r = await impact(store, "ledger");
    expect(r.notes.map((n) => [n.id, n.depth, n.via, n.linkType]).sort()).toEqual([
      ["checkout", 2, "payments", "depends_on"],
      ["payments", 1, "ledger", "depends_on"],
      ["payments-tests", 2, "payments", "tested_by"],
      ["refunds", 2, "payments", "implements"],
    ]);
    expect(r.github).toHaveLength(1);
    expect(r.github[0]).toMatchObject({ key: "acme/app#7", notes: ["checkout"], node: { state: "open", title: "Checkout epic" } });
    expect((await impact(store, "ledger", { depth: 1 })).notes.map((n) => n.id)).toEqual(["payments"]);
    expect((await impact(store, "island")).notes).toEqual([]);
  });

  it("lint: orphans and broken links", async () => {
    const l = await lint(store);
    expect(l.orphans).toEqual(["island"]);
    expect(l.broken).toEqual([{ from: "payments", target: "ghost", line: 8 }]);
    expect((await lint(store, { spaces: ["secret"] })).orphans).toEqual([]);
  });
});
