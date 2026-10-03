import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadVault } from "./vault.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/vault-obsidian", import.meta.url));

// Conformance: a plain Obsidian vault is read as Obsidian reads it (FR-001, NFR-004).
describe("Obsidian vault conformance", async () => {
  const vault = await loadVault(FIXTURE);
  const home = vault.notes.find((n) => n.id === "Home");
  const resolve = (target: string, from = "Home") =>
    vault.resolve({ target, kind: "note", type: "related", strict: false, source: "body", line: 1 }, from);

  it("skips dot-folders such as .obsidian", () => {
    expect(vault.notes.map((n) => n.id).sort()).toEqual([
      "Archive/Meeting notes",
      "Embedded note",
      "Home",
      "Meeting notes",
      "Projects/Alpha",
    ]);
  });

  it("resolves every body link of Home", () => {
    expect(home?.links.map((l) => l.target)).toEqual(["Projects/Alpha", "Alpha Project", "Meeting notes", "Embedded note", "Embedded note"]);
    for (const l of home?.links ?? []) expect(vault.resolve(l, "Home").status).toBe("resolved");
  });

  it("resolves by frontmatter alias", () => {
    const r = resolve("alpha project");
    expect(r.status === "resolved" && r.note.id).toBe("Projects/Alpha");
  });

  it("picks the shortest path when a name is ambiguous, like Obsidian", () => {
    const r = resolve("Meeting notes");
    expect(r).toMatchObject({ status: "resolved", ambiguous: 2 });
    expect(r.status === "resolved" && r.note.id).toBe("Meeting notes");
  });

  it("is case-insensitive and accepts a .md suffix", () => {
    expect(resolve("projects/alpha.md").status).toBe("resolved");
  });

  it("checks headings", () => {
    const link = home?.links.find((l) => l.heading === "Decisions");
    expect(link && vault.resolve(link, "Home")).toMatchObject({ headingFound: true });
  });

  it("reports missing targets", () => {
    expect(resolve("nope").status).toBe("missing");
  });
});
