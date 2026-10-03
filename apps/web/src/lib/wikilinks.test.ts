import { describe, expect, it } from "vitest";
import { makeResolver, parseWikiRef, remarkWikilinks } from "./wikilinks";
import type { LinkView } from "./types";

const note = (target: string, id: string, title: string): LinkView => ({ type: "related", kind: "note", target, heading: null, line: 1, source: "body", note: { id, title, type: null, status: null }, github: null, broken: false });

describe("parseWikiRef", () => {
  it("splits target, heading and alias; keeps GitHub keys whole", () => {
    expect(parseWikiRef("auth#Flow|implements")).toEqual({ target: "auth", heading: "Flow", alias: "implements", github: false });
    expect(parseWikiRef("gh:acme/app#12|tracked_by")).toEqual({ target: "gh:acme/app#12", alias: "tracked_by", github: true });
    expect(parseWikiRef("pic.png")).toBeNull();
    expect(parseWikiRef("#local")).toBeNull();
  });
});

describe("remarkWikilinks", () => {
  const run = (text: string, links: LinkView[]) => {
    const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: text }] }, { type: "code", value: "[[not]]" }] };
    remarkWikilinks({ resolve: makeResolver(links) })()(tree as never);
    return tree.children[0]?.children;
  };

  it("links resolved notes with their title and an encoded path", () => {
    const out = run("see [[auth]] now", [note("auth", "specs/auth login", "Login")]);
    expect(out).toEqual([
      { type: "text", value: "see " },
      { type: "link", url: "/n/specs/auth%20login", children: [{ type: "text", value: "Login" }] },
      { type: "text", value: " now" },
    ]);
  });

  it("uses a display alias but not a link type as the label", () => {
    const links = [note("auth", "auth", "Login")];
    expect(JSON.stringify(run("[[auth|click here]]", links))).toContain("click here");
    expect(JSON.stringify(run("[[auth|implements]]", links))).toContain("Login");
  });

  it("adds the heading anchor, marks broken links, shows GitHub state", () => {
    const gh: LinkView = { type: "tracked_by", kind: "github", target: "gh:acme/app#7", heading: null, line: 1, source: "body", note: null, broken: false, github: { key: "acme/app#7", kind: "issue", state: "open", title: "T", labels: [], author: null, url: "https://github.com/acme/app/issues/7" } };
    expect(JSON.stringify(run("[[auth#Login flow]]", [note("auth", "auth", "A")]))).toContain("/n/auth#login-flow");
    expect(JSON.stringify(run("[[ghost]]", []))).toContain('"url":"#broken"');
    const out = JSON.stringify(run("[[gh:acme/app#7|tracked_by]]", [gh]));
    expect(out).toContain("https://github.com/acme/app/issues/7#dfl-open");
    expect(out).toContain("acme/app#7 T");
    // not synced: still a link to GitHub, marked as such, never a broken link
    const unsynced = JSON.stringify(run("[[gh:acme/app#12]] and [[gh:nonsense]]", []));
    expect(unsynced).toContain("https://github.com/acme/app/issues/12#dfl-unsynced");
    expect(unsynced).toContain('"url":"#broken"');
  });

  it("leaves code blocks and text without links alone", () => {
    expect(run("no links here", [])).toEqual([{ type: "text", value: "no links here" }]);
  });
});
