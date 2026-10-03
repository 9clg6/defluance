import { describe, expect, it } from "vitest";
import { relativeTime, slugFromTitle, splitFrontmatter, stripTitle } from "./frontmatter";
import { idFromPath, notePath, qs } from "./api";

describe("helpers", () => {
  it("splits frontmatter from body", () => {
    expect(splitFrontmatter("---\ntype: note\n---\n# T\n")).toEqual({ frontmatter: "type: note", body: "# T\n" });
    expect(splitFrontmatter("# T")).toEqual({ frontmatter: "", body: "# T" });
  });
  it("drops the body's first heading only when it repeats the title", () => {
    expect(stripTitle("# Login\n\nText\n", "Login")).toBe("Text\n");
    expect(stripTitle("# login\nText", "Login")).toBe("Text");
    expect(stripTitle("# Other\nText", "Login")).toBe("# Other\nText");
    expect(stripTitle("Intro\n# Login\n", "Login")).toBe("Intro\n# Login\n");
  });
  it("slugs titles", () => {
    expect(slugFromTitle("Spécification d'authentification")).toBe("specification-d-authentification");
  });
  it("round-trips note ids through paths", () => {
    for (const id of ["a", "produit/auth login", "tech/été/cœur"]) expect(idFromPath(`${notePath(id)}/`)).toBe(id);
    expect(idFromPath("/n/")).toBe("");
  });
  it("builds query strings without empty values", () => {
    expect(qs({ a: "x y", b: undefined, c: "", d: 0 })).toBe("?a=x+y&d=0");
    expect(qs({})).toBe("");
  });
  it("formats relative time", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(relativeTime("2026-10-05T10:00:00Z", "en", now)).toBe("2 hours ago");
    expect(relativeTime("2026-10-04T12:00:00Z", "en", now)).toBe("yesterday");
  });
});
