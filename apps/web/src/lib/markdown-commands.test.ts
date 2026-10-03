import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import * as md from "./markdown-commands";

// `«` and `»` mark the selection, `¦` the cursor (Markdown's own brackets stay out of the way).
function make(src: string): EditorState {
  const a = src.indexOf("«");
  const b = src.indexOf("»");
  const cursor = src.indexOf("¦");
  const doc = src.replace(/[«»¦]/g, "");
  const selection = a >= 0 ? EditorSelection.range(a, b - 1) : EditorSelection.cursor(cursor >= 0 ? cursor : doc.length);
  return EditorState.create({ doc, selection, extensions: [markdown({ base: markdownLanguage })] });
}

/** The document and the selection after a command, in the same notation. */
function apply(src: string, cmd: md.Command): string {
  const state = make(src);
  const next = state.update(cmd(state) as TransactionSpec).state;
  const { from, to } = next.selection.main;
  const d = next.doc.toString();
  return from === to ? `${d.slice(0, from)}¦${d.slice(from)}` : `${d.slice(0, from)}«${d.slice(from, to)}»${d.slice(to)}`;
}

describe("inline formats", () => {
  it("wraps the selection and keeps it selected", () => {
    expect(apply("a «word» b", md.toggleInline("bold"))).toBe("a **«word»** b");
    expect(apply("a «word» b", md.toggleInline("italic"))).toBe("a *«word»* b");
    expect(apply("a «word» b", md.toggleInline("strike"))).toBe("a ~~«word»~~ b");
    expect(apply("a «word» b", md.toggleInline("code"))).toBe("a `«word»` b");
  });

  it("takes bold off text that is already bold, whether the selection is inside or around it", () => {
    expect(apply("a **«word»** b", md.toggleInline("bold"))).toBe("a «word» b");
    expect(apply("a «**word**» b", md.toggleInline("bold"))).toBe("a «word» b");
    expect(apply("a **wo¦rd** b", md.toggleInline("bold"))).toBe("a wo¦rd b");
    expect(apply("a ~~«gone»~~ b", md.toggleInline("strike"))).toBe("a «gone» b");
    expect(apply("a *«it»* b", md.toggleInline("italic"))).toBe("a «it» b");
  });

  it("makes italic text bold without losing the italic, and back", () => {
    expect(apply("*«x»*", md.toggleInline("bold"))).toBe("***«x»***");
    expect(apply("***«x»***", md.toggleInline("bold"))).toBe("*«x»*");
  });

  it("inserts a placeholder, selected, when nothing is selected", () => {
    expect(apply("a ¦ b", md.toggleInline("bold"))).toBe("a **«bold text»** b");
    expect(apply("a ¦ b", md.toggleInline("bold", "gras"))).toBe("a **«gras»** b");
  });

  it("keeps the markers off the spaces around the selection", () => {
    expect(apply("a« word »b", md.toggleInline("bold"))).toBe("a **«word»** b");
  });
});

describe("headings", () => {
  it("sets, replaces and toggles the level", () => {
    expect(apply("Title¦", md.setHeading(1))).toBe("# Title¦");
    expect(apply("## Title¦", md.setHeading(3))).toBe("### Title¦");
    expect(apply("## Title¦", md.setHeading(2))).toBe("Title¦");
    expect(apply("## Title¦", md.setHeading(0))).toBe("Title¦");
    expect(apply("#### Deep¦", md.setHeading(1))).toBe("# Deep¦");
  });

  it("applies to every selected line", () => {
    expect(apply("«one\ntwo»", md.setHeading(2))).toBe("## «one\n## two»");
  });
});

describe("lists", () => {
  it("bullets every non-blank selected line, and takes them off again", () => {
    expect(apply("«a\n\nb»", md.toggleList("bullet"))).toBe("- «a\n\n- b»");
    expect(apply("- «a\n- b»", md.toggleList("bullet"))).toBe("«a\nb»");
  });

  it("numbers the lines from 1, and changes another list into it", () => {
    expect(apply("«a\nb\nc»", md.toggleList("numbered"))).toBe("1. «a\n2. b\n3. c»");
    expect(apply("- «a\n- b»", md.toggleList("numbered"))).toBe("1. «a\n2. b»");
    expect(apply("1. «a\n2. b»", md.toggleList("numbered"))).toBe("«a\nb»");
  });

  it("makes a checklist, keeping the indent, and turns it back", () => {
    expect(apply("«a\n  b»", md.toggleList("task"))).toBe("- [ ] «a\n  - [ ] b»");
    expect(apply("- [ ] «a\n- [x] b»", md.toggleList("task"))).toBe("«a\nb»");
    expect(apply("- [x] done¦", md.toggleList("bullet"))).toBe("- done¦");
  });

  it("starts a list on an empty line", () => {
    expect(apply("¦", md.toggleList("bullet"))).toBe("- ¦");
  });

  it("quotes lines and unquotes them", () => {
    expect(apply("«a\nb»", md.toggleQuote)).toBe("> «a\n> b»");
    expect(apply("> «a\n> b»", md.toggleQuote)).toBe("«a\nb»");
  });
});

describe("blocks", () => {
  it("inserts a 3x3 table on its own lines with the first title selected", () => {
    expect(apply("Intro¦", md.insertTable)).toBe("Intro\n\n| «Column 1» | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n");
  });

  it("uses an empty line up instead of adding one", () => {
    expect(apply("Intro\n\n¦\n\nOutro", md.insertRule)).toBe("Intro\n\n---¦\n\nOutro");
  });

  it("fences selected lines, unfences a block, and starts an empty one", () => {
    expect(apply("«a\nb»", md.toggleCodeBlock())).toBe("```\n«a\nb»\n```");
    expect(apply("```\na¦\nb\n```", md.toggleCodeBlock())).toBe("a¦\nb");
    expect(apply("¦", md.toggleCodeBlock())).toBe("```\n«code»\n```\n");
  });

  it("inserts a callout with its title selected, or wraps the selected lines", () => {
    expect(apply("¦", md.insertCallout("warning"))).toBe("> [!warning] «Title»\n");
    expect(apply("«a\nb»", md.insertCallout("tip", "Hint"))).toBe("> [!tip] «Hint»\n> a\n> b");
  });
});

describe("links", () => {
  it("wraps the selection, or inserts placeholder text", () => {
    expect(apply("see «docs» now", md.insertLink("https://x.io"))).toBe("see [docs](https://x.io)¦ now");
    expect(apply("see ¦", md.insertLink("https://x.io"))).toBe("see [link text](https://x.io)¦");
  });

  it("changes the address of a link the cursor is in", () => {
    expect(apply("[a](http://old¦)", md.insertLink("http://new"))).toBe("[a](http://new¦)");
  });

  it("inserts note links after the selection", () => {
    expect(apply("see ¦", md.insertNoteLink("tech/glossary"))).toBe("see [[tech/glossary]]¦");
    expect(apply("see ¦", md.insertNoteLink("tech/glossary", "related"))).toBe("see [[tech/glossary|related]]¦");
  });

  it("starts a mention where one can start", () => {
    expect(apply("see ¦", md.insertMentionTrigger)).toBe("see @¦");
    expect(apply("see¦", md.insertMentionTrigger)).toBe("see @¦");
  });
});

describe("active formats", () => {
  it("reports what the cursor is in", () => {
    expect([...md.activeFormats(make("## **bo¦ld**"))].sort()).toEqual(["bold", "h2"]);
    expect([...md.activeFormats(make("- [ ] [a](http://x¦)"))].sort()).toEqual(["link", "task"]);
    expect([...md.activeFormats(make("> q¦"))]).toEqual(["quote"]);
    expect([...md.activeFormats(make("plain¦"))]).toEqual([]);
  });
});
