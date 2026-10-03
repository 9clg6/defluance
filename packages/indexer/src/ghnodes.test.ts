import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GhNode, IndexStore } from "./store.js";
import { dialects, openTestStore } from "./test-env.js";

const node = (key: string, over: Partial<GhNode> = {}): GhNode => ({
  key, kind: "issue", state: "open", title: "Title", labels: [], author: null, files: [], merged_at: null, url: null, updated_at: "2026-09-01T00:00:00Z", ...over,
});

describe.each(dialects)("listGhNodes (%s)", (dialect) => {
  let store: IndexStore;
  beforeAll(async () => {
    store = await openTestStore(dialect);
    for (const n of [
      node("acme/app#12", { title: "Password reset fails", labels: ["bug", "auth"], author: "Nadia", updated_at: "2026-09-02T00:00:00Z" }),
      node("acme/app#112", { title: "Unrelated", updated_at: "2026-09-09T00:00:00Z" }),
      node("acme/app#21", { kind: "pull-request", state: "merged", title: "Rotate tokens", labels: ["security"], author: "karim", updated_at: "2026-09-05T00:00:00Z" }),
      node("Acme/Web#3", { kind: "pull-request", title: "100% coverage_gate", state: "closed", updated_at: "2026-09-03T00:00:00Z" }),
      node("other/repo#12", { title: "Elsewhere", updated_at: "2026-09-10T00:00:00Z" }),
    ]) await store.upsertGhNode(n);
  });
  afterAll(() => store.db.close());

  const keys = async (f: Parameters<IndexStore["listGhNodes"]>[0]) => (await store.listGhNodes(f)).map((n) => n.key);

  it("lists newest first and honours the limit", async () => {
    expect(await keys({})).toEqual(["other/repo#12", "acme/app#112", "acme/app#21", "Acme/Web#3", "acme/app#12"]);
    expect(await keys({ limit: 2 })).toEqual(["other/repo#12", "acme/app#112"]);
  });

  it("restricts to repos, case-insensitively; an empty list matches nothing", async () => {
    expect(await keys({ repos: ["ACME/app"] })).toEqual(["acme/app#112", "acme/app#21", "acme/app#12"]);
    expect(await keys({ repos: ["acme/web", "other/repo"] })).toEqual(["other/repo#12", "Acme/Web#3"]);
    expect(await keys({ repos: [] })).toEqual([]);
  });

  it("filters by kind and state", async () => {
    expect(await keys({ kind: "pull-request" })).toEqual(["acme/app#21", "Acme/Web#3"]);
    expect(await keys({ state: "merged" })).toEqual(["acme/app#21"]);
    expect(await keys({ kind: "issue", state: "closed" })).toEqual([]);
  });

  it("puts an exact number first, with or without #", async () => {
    expect(await keys({ q: "12", repos: ["acme/app"] })).toEqual(["acme/app#12", "acme/app#112"]);
    expect(await keys({ q: "#12" })).toEqual(["other/repo#12", "acme/app#12", "acme/app#112"]);
  });

  it("matches text in title, labels, author and key, ignoring case and treating % and _ literally", async () => {
    expect(await keys({ q: "PASSWORD" })).toEqual(["acme/app#12"]);
    expect(await keys({ q: "security" })).toEqual(["acme/app#21"]);
    expect(await keys({ q: "nadia" })).toEqual(["acme/app#12"]);
    expect(await keys({ q: "acme/web" })).toEqual(["Acme/Web#3"]);
    expect(await keys({ q: "100%" })).toEqual(["Acme/Web#3"]);
    expect(await keys({ q: "coverage_g" })).toEqual(["Acme/Web#3"]);
    expect(await keys({ q: "nothing-like-this" })).toEqual([]);
  });
});
