import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { bodyStart, buildLivePreview, frontmatterOf, linkAt, listDecorations } from "./live-preview";

function state(doc: string, at = doc.length) {
  return EditorState.create({ doc, selection: EditorSelection.cursor(at), extensions: [markdown({ base: markdownLanguage })] });
}

/** Decorations for the whole document, as `[text, kind, class]`: what each hidden or styled range covers. */
function describeDoc(doc: string, at = doc.length) {
  const s = state(doc, at);
  const built = buildLivePreview(s, [{ from: 0, to: s.doc.length }]);
  return listDecorations(built.decorations).map(([from, to, kind, cls]) => [s.doc.sliceString(from, to), kind, cls] as const);
}

const hidden = (doc: string, at?: number) => describeDoc(doc, at).filter((d) => d[1] === "hide").map((d) => d[0]);

describe("live preview decorations", () => {
  it("hides the marks away from the cursor and shows them on the cursor's line", () => {
    const doc = "# Title\n\nSome **bold** and *it* text\n\nlast";
    expect(hidden(doc, doc.length)).toEqual(["# ", "**", "**", "*", "*"]);
    // the cursor in the heading line shows its `# `, the others stay hidden
    expect(hidden(doc, 3)).toEqual(["**", "**", "*", "*"]);
    // the cursor on the bold line shows its marks
    expect(hidden(doc, doc.indexOf("bold"))).toEqual(["# "]);
  });

  it("styles headings by level, bold, italic, strike and inline code", () => {
    const d = describeDoc("## Two\n\n**b** *i* ~~s~~ `c`");
    expect(d).toContainEqual(["", "line", "cm-lp-h2"]);
    expect(d).toContainEqual(["**b**", "mark", "cm-lp-strong"]);
    expect(d).toContainEqual(["*i*", "mark", "cm-lp-em"]);
    expect(d).toContainEqual(["~~s~~", "mark", "cm-lp-strike"]);
    expect(d).toContainEqual(["`c`", "mark", "cm-lp-code-inline"]);
  });

  it("shows a link as its text and keeps the raw form on the selected line", () => {
    const doc = "see [the docs](https://x.io/a) here\n\nend";
    expect(hidden(doc)).toEqual(["[", "](https://x.io/a)"]);
    expect(describeDoc(doc)).toContainEqual(["the docs", "mark", "cm-lp-link"]);
    expect(hidden(doc, 5)).toEqual([]);
  });

  it("shows [[a|type]] as a, a gh reference as a chip, and leaves embeds as text", () => {
    const doc = "[[a|related]] [[gh:acme/app#12]] ![[x.png]]\n\nend";
    const d = describeDoc(doc);
    expect(d.filter((x) => x[1] === "hide").map((x) => x[0])).toEqual(["[[", "|related]]"]);
    expect(d).toContainEqual(["a", "mark", "cm-lp-wikilink"]);
    expect(d).toContainEqual(["[[gh:acme/app#12]]", "widget", "ChipWidget"]);
    expect(d).toContainEqual(["![[x.png]]", "mark", "cm-lp-embed"]);
    // on the cursor's line everything is raw (the chip too)
    expect(describeDoc(doc, 3).filter((x) => x[1] === "hide" || x[1] === "widget")).toEqual([]);
  });

  it("does not read wikilinks inside code", () => {
    expect(describeDoc("`[[a|b]]`\n\n```\n[[c]]\n```\n\nend").filter((d) => d[2] === "cm-lp-wikilink")).toEqual([]);
  });

  it("turns list dashes into bullets and tasks into checkboxes", () => {
    const d = describeDoc("- one\n- [ ] todo\n- [x] done\n1. first\n\nend");
    expect(d.filter((x) => x[1] === "widget").map((x) => [x[0], x[2]])).toEqual([["-", "BulletWidget"], ["- [ ]", "CheckboxWidget"], ["- [x]", "CheckboxWidget"]]);
    expect(d).toContainEqual(["1.", "mark", "cm-lp-ol"]);
  });

  it("styles quotes and callouts, and hides the `>`", () => {
    const d = describeDoc("> plain\n\n> [!warning] Careful\n> body\n\nend");
    expect(d).toContainEqual(["", "line", "cm-lp-quote"]);
    expect(d).toContainEqual(["", "line", "cm-lp-callout cm-lp-callout-warning cm-lp-callout-first"]);
    expect(d).toContainEqual(["[!warning]", "mark", "cm-lp-callout-kind"]);
    expect(d).toContainEqual(["Careful", "mark", "cm-lp-callout-title"]);
    expect(hidden("> plain\n\n> [!warning] Careful\n> body\n\nend")).toEqual(["> ", "> ", "> "]);
  });

  it("styles fenced code lines and a horizontal rule", () => {
    const d = describeDoc("```js\ncode\n```\n\n---\n\nend");
    expect(d.filter((x) => x[2].startsWith("cm-lp-code ") || x[2] === "cm-lp-code").length).toBe(3);
    expect(d).toContainEqual(["", "line", "cm-lp-hr"]);
    expect(d.filter((x) => x[1] === "hide").map((x) => x[0])).toEqual(["```", "```", "---"]);
  });

  it("never changes the document", () => {
    const doc = "---\ntype: note\n---\n# T\n\n**b** [a](u) [[x|y]] - [ ] t\n\n```\nc\n```\n";
    const s = state(doc, 0);
    buildLivePreview(s, [{ from: 0, to: s.doc.length }]);
    expect(s.doc.toString()).toBe(doc);
  });

  it("only decorates the ranges it is given", () => {
    const doc = "**a**\n\n\n\n**b**";
    const s = state(doc, 0);
    const marks = listDecorations(buildLivePreview(s, [{ from: 9, to: doc.length }]).decorations).filter((d) => d[3] === "cm-lp-strong");
    expect(marks).toEqual([[9, 14, "mark", "cm-lp-strong"]]);
  });

  it("lists the hidden ranges as atomic, so the cursor skips them", () => {
    const s = state("**a** b\n\nend");
    const atoms = listDecorations(buildLivePreview(s, [{ from: 0, to: s.doc.length }]).atomic).map((d) => d.slice(0, 3));
    expect(atoms).toEqual([[0, 2, "hide"], [3, 5, "hide"]]);
  });
});

describe("frontmatter", () => {
  const note = "---\ntype: note\nstatus: draft\ntags: [a]\n  - not a key\n---\n# Body\n";

  it("is found with its number of keys, by the server's rule", () => {
    expect(frontmatterOf(state(note))).toMatchObject({ keys: 3, to: note.indexOf("\n# Body") });
    expect(frontmatterOf(state("---\n---\n# x\n"))).toBeNull();
    expect(frontmatterOf(state("# x\n---\na: b\n---\n"))).toBeNull();
    expect(bodyStart(state(note))).toBe(note.indexOf("# Body"));
  });

  it("is not read as markdown, and its raw lines get a background once the cursor is in", () => {
    const body = describeDoc(note, note.length).map((d) => d[2]);
    expect(body).not.toContain("cm-lp-hr");
    expect(body).not.toContain("cm-lp-fm");
    const open = describeDoc(note, 8).filter((d) => d[2] === "cm-lp-fm");
    expect(open).toHaveLength(6);
  });
});

describe("links under the pointer", () => {
  it("finds web addresses, notes and GitHub issues", () => {
    const doc = "[a](https://x.io) [[tech/glossary#h|related]] [[gh:acme/app#12]] plain";
    const s = state(doc);
    expect(linkAt(s, 3)).toBe("https://x.io");
    expect(linkAt(s, doc.indexOf("tech") + 2)).toBe("/n/tech/glossary/");
    expect(linkAt(s, doc.indexOf("gh:") + 2)).toBe("https://github.com/acme/app/issues/12");
    expect(linkAt(s, doc.indexOf("plain"))).toBeNull();
  });
});
