import { describe, expect, it } from "vitest";
import { parseNote } from "./parse.js";

const p = (body: string) => parseNote("n.md", body);

describe("wikilinks", () => {
  it("parses a typed link", () => {
    const [l] = p("[[auth-login|implements]]").links;
    expect(l).toMatchObject({ target: "auth-login", type: "implements", kind: "note", strict: false });
  });

  it("defaults to related without alias", () => {
    expect(p("[[x]]").links[0]).toMatchObject({ type: "related" });
  });

  it("keeps an unknown alias as display alias", () => {
    const [l] = p("[[x|click here]]").links;
    expect(l).toMatchObject({ type: "related", alias: "click here", unknownType: "click here" });
  });

  it("splits heading", () => {
    expect(p("[[x#Decisions|blocks]]").links[0]).toMatchObject({ target: "x", heading: "Decisions", type: "blocks" });
  });

  it("keeps GitHub keys intact: # is not a heading separator", () => {
    const [l] = p("[[gh:acme/app#12|tracked_by]]").links;
    expect(l).toMatchObject({ kind: "github", target: "gh:acme/app#12", type: "tracked_by" });
    expect(l?.heading).toBeUndefined();
  });

  it("ignores code, inline code, attachments and same-note anchors", () => {
    const body = "```\n[[a]]\n```\n`[[b]]` ![[pic.png]] [[#local]] [[real]]";
    expect(p(body).links.map((l) => l.target)).toEqual(["real"]);
  });

  it("reports the line number, offset by the frontmatter", () => {
    const raw = "---\ntype: note\n---\n# T\n\ntext [[a]]\n";
    expect(parseNote("n.md", raw).links[0]?.line).toBe(6);
  });

  it("uses custom link types when given", () => {
    const n = parseNote("n.md", "[[x|mentors]]", { linkTypes: ["mentors"] });
    expect(n.links[0]?.type).toBe("mentors");
  });
});

describe("frontmatter", () => {
  it("reads string and object links, object form is strict", () => {
    const raw = "---\nlinks:\n  - '[[a|depends_on]]'\n  - { to: b, type: nope }\n---\n";
    const links = parseNote("n.md", raw).links;
    expect(links[0]).toMatchObject({ target: "a", type: "depends_on", source: "frontmatter", strict: false });
    expect(links[1]).toMatchObject({ target: "b", unknownType: "nope", strict: true });
  });

  it("reports invalid YAML without throwing", () => {
    const n = parseNote("n.md", "---\nkey: [unclosed\n---\n# T");
    expect(n.frontmatterError).toBeTruthy();
    expect(n.frontmatter).toEqual({});
  });

  it("title: frontmatter, then first h1, then file name", () => {
    expect(parseNote("a/b.md", "---\ntitle: FM\n---\n# H").title).toBe("FM");
    expect(parseNote("a/b.md", "# H1\n").title).toBe("H1");
    expect(parseNote("a/b.md", "no heading").title).toBe("b");
  });

  it("collects headings", () => {
    const n = p("# A\n\n## B `x`\n");
    expect(n.headings).toEqual([
      { depth: 1, text: "A", line: 1 },
      { depth: 2, text: "B x", line: 3 },
    ]);
  });
});

describe("inline tags", () => {
  const tags = (body: string) => parseNote("n.md", `---\ntype: note\n---\n${body}`).inlineTags;

  it("finds #tags in the text, like Obsidian", () => {
    expect(tags("An #idea for the #team/backend, also #ünïcode and #snake_case-1.")).toEqual(["idea", "snake_case-1", "team/backend", "ünïcode"]);
  });

  it("does not take numbers, anchors, URLs, headings or code for tags", () => {
    expect(tags("Issue #123, [[note#Heading]], https://x.example/y#frag, a#b.\n\n# A heading\n\n`#inline`\n\n```\n#fenced\n```\n")).toEqual([]);
  });

  it("is empty for a note without any", () => {
    expect(tags("Nothing here.")).toEqual([]);
  });
});
