import { describe, expect, it } from "vitest";
import { type GhLabels, ghOption, parseMention } from "./mention";

describe("parseMention", () => {
  it("opens on a bare @, at the start of the line or after a space", () => {
    expect(parseMention("@")).toEqual({ from: 0, q: "" });
    expect(parseMention("see @")).toEqual({ from: 4, q: "" });
    expect(parseMention("see\t@fix")).toEqual({ from: 4, q: "fix" });
    expect(parseMention("- @12")).toEqual({ from: 2, q: "12" });
    expect(parseMention("@#12")).toEqual({ from: 0, q: "#12" });
  });

  it("never opens on an email address or inside a word", () => {
    expect(parseMention("a@b.com")).toBeNull();
    expect(parseMention("write to a@")).toBeNull();
    expect(parseMention("no mention here")).toBeNull();
    expect(parseMention("@fix and then more words")).toBeNull();
  });

  it("does not open inside an unclosed wikilink, but does after a closed one", () => {
    expect(parseMention("[[note @x")).toBeNull();
    expect(parseMention("[[note]] @x")).toEqual({ from: 9, q: "x" });
  });

  it("reads pr and issue as a kind filter, any case, with the rest as the query", () => {
    expect(parseMention("@pr")).toEqual({ from: 0, kind: "pull-request", q: "" });
    expect(parseMention("@PR ")).toEqual({ from: 0, kind: "pull-request", q: "" });
    expect(parseMention("@pr login bug")).toEqual({ from: 0, kind: "pull-request", q: "login bug" });
    expect(parseMention("see @Issue #12")).toEqual({ from: 4, kind: "issue", q: "#12" });
    expect(parseMention("@issue 12")).toEqual({ from: 0, kind: "issue", q: "12" });
  });

  it("treats words that merely start with a keyword as a query", () => {
    expect(parseMention("@prefix")).toEqual({ from: 0, q: "prefix" });
    expect(parseMention("@issues")).toEqual({ from: 0, q: "issues" });
  });
});

describe("ghOption", () => {
  const node = { key: "acme/app#12", kind: "pull-request" as const, state: "open" as const, title: "Fix reset" };
  it("shows #number title, kind / state / repo, and inserts a wikilink without link type", () => {
    expect(ghOption(node)).toEqual({ label: "#12 Fix reset", detail: "PR · open · acme/app", insert: "[[gh:acme/app#12]]" });
    expect(ghOption({ ...node, kind: "issue", state: "merged" }).detail).toBe("issue · merged · acme/app");
  });
  it("uses the labels it is given", () => {
    const fr: GhLabels = { pr: "PR", issue: "issue", state: (s) => ({ open: "ouverte", closed: "fermée", merged: "fusionnée" })[s] };
    expect(ghOption(node, fr).detail).toBe("PR · ouverte · acme/app");
  });
  it("keeps a # in the title and splits the key on the last #", () => {
    expect(ghOption({ ...node, key: "acme/app#7", title: "Fix #3" })).toMatchObject({ label: "#7 Fix #3", insert: "[[gh:acme/app#7]]" });
  });
});
