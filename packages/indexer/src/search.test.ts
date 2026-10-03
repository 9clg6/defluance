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
    });
    cleanup = v.remove;
    await indexVault(store, {
      root: v.root,
      embedder,
      config: { spaces: [{ name: "produit", path: "produit", repos: [] }], repos: [], agentWriteMode: "branch" },
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

  it("returns one hit per note, honours limit, and handles empty or odd queries", async () => {
    const hits = await search(store, "the", { limit: 1 });
    expect(hits.length).toBeLessThanOrEqual(1);
    expect(await search(store, "   ")).toEqual([]);
    expect(await search(store, `"; DROP TABLE notes; --`)).toEqual([]);
    expect(await search(store, "zzzzunknownzzzz")).toEqual([]);
    expect((await store.counts()).notes).toBe(4);
  });
});
