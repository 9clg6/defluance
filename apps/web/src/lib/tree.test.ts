import { describe, expect, it } from "vitest";
import { buildTree } from "./tree";
import type { NoteSummary } from "./types";

const n = (id: string, title = id, extra: Partial<NoteSummary> = {}): NoteSummary => ({ id, title, type: "note", status: "draft", owner: "a", space: "default", tags: [], updated_at: "2026-01-01", ...extra });

describe("buildTree", () => {
  const notes = [n("tech/sessions", "Sessions"), n("readme", "Readme"), n("produit/auth/login", "Login"), n("produit/password-reset", "Password reset"), n("tech/adr/0001", "ADR 1")];

  it("folds ids into folders, folders first, sorted", () => {
    const { nodes } = buildTree(notes);
    expect(nodes.map((x) => x.id)).toEqual(["dir:produit", "dir:tech", "note:readme"]);
    const produit = nodes[0]?.children ?? [];
    expect(produit.map((x) => x.id)).toEqual(["dir:produit/auth", "note:produit/password-reset"]);
    expect(produit[0]?.children?.[0]).toMatchObject({ id: "note:produit/auth/login", label: "Login" });
  });

  it("filters by title or path and lists the folders that hold a match", () => {
    const { nodes, open } = buildTree(notes, "login");
    expect(nodes).toHaveLength(1);
    expect(open.sort()).toEqual(["dir:produit", "dir:produit/auth"]);
    expect(buildTree(notes, "adr").nodes[0]?.children?.[0]?.children?.[0]?.id).toBe("note:tech/adr/0001");
    expect(buildTree(notes, "nothing like it").nodes).toEqual([]);
  });

  it("shows a locked private note by its file name, not a title it cannot know", () => {
    const { nodes } = buildTree([n("secret/falcon", "falcon", { private: true, locked: true }), n("secret/open", "Real title", { private: true, locked: false })]);
    const children = nodes[0]?.children ?? [];
    expect(children).toEqual([
      { id: "note:secret/falcon", label: "falcon", private: true },
      { id: "note:secret/open", label: "Real title", private: true },
    ]);
  });
});
