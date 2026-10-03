import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, EditorSelection, type Line, type TransactionSpec } from "@codemirror/state";

// Formatting commands of the toolbar and the shortcuts. Each is a pure `(state) => transaction spec`: it only reads the
// state and describes the change, so the editor (and the Yjs binding under it) sees ordinary transactions. The commands
// toggle: formatting text that already has the format removes it.

type Node = ReturnType<typeof syntaxTree>["topNode"];

export type Inline = "bold" | "italic" | "strike" | "code";
export type Format = Inline | "link" | "h1" | "h2" | "h3" | "bullet" | "numbered" | "task" | "quote" | "codeblock";
export type Command = (state: EditorState) => TransactionSpec;

const tree = (state: EditorState) => ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);

/** The node called `name` that holds [from, to], looking at both sides of `from` so a cursor at an edge still finds it. */
function enclosing(state: EditorState, from: number, to: number, name: string): Node | null {
  const t = tree(state);
  for (const side of [-1, 1] as const) {
    for (let n: Node | null = t.resolveInner(from, side); n; n = n.parent) {
      if (n.name === name && n.from <= from && n.to >= to) return n;
    }
  }
  return null;
}

const INLINE: Record<Inline, { node: string; mark: string; placeholder: string }> = {
  bold: { node: "StrongEmphasis", mark: "**", placeholder: "bold text" },
  italic: { node: "Emphasis", mark: "*", placeholder: "italic text" },
  strike: { node: "Strikethrough", mark: "~~", placeholder: "struck text" },
  code: { node: "InlineCode", mark: "`", placeholder: "code" },
};

/** Wrap the selection in `**`, `*`, `~~` or backticks, or take them off when it is already inside. Without a selection a placeholder is inserted and selected. */
export function toggleInline(kind: Inline, placeholder: string = INLINE[kind].placeholder): Command {
  const { node: name, mark: m } = INLINE[kind];
  return (state) =>
    state.changeByRange((range) => {
      const found = enclosing(state, range.from, range.to, name);
      if (found) {
        const marks: Node[] = [];
        for (let c = found.firstChild; c; c = c.nextSibling) if (c.name.endsWith("Mark")) marks.push(c);
        const first = marks[0];
        const last = marks.at(-1);
        if (first && last && first !== last) {
          const changes = state.changes([{ from: first.from, to: first.to }, { from: last.from, to: last.to }]);
          return { changes, range: range.map(changes, 1) };
        }
      }
      const text = state.sliceDoc(range.from, range.to);
      if (!text.trim()) {
        const insert = `${m}${placeholder}${m}`;
        return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(range.from + m.length, range.from + m.length + placeholder.length) };
      }
      // Markers next to a space do not format anything: keep the spaces outside.
      const from = range.from + (text.length - text.trimStart().length);
      const to = range.to - (text.length - text.trimEnd().length);
      return { changes: [{ from, insert: m }, { from: to, insert: m }], range: EditorSelection.range(from + m.length, to + m.length) };
    });
}

// ---------------------------------------------------------------- line commands

const TASK = /^(\s*)[-*+] \[[ xX]\] /;
const BULLET = /^(\s*)[-*+] /;
const NUMBERED = /^(\s*)\d+[.)] /;
const QUOTE = /^(\s*)> ?/;
const HEADING = /^(#{1,6})[ \t]+/;

type ListKind = "bullet" | "numbered" | "task";
const LIST_RE: [ListKind, RegExp][] = [["task", TASK], ["bullet", BULLET], ["numbered", NUMBERED]];

/** Which list marker starts this line, and the match that covers it. */
function listOf(text: string): { kind: ListKind; m: RegExpExecArray } | null {
  for (const [kind, re] of LIST_RE) {
    const m = re.exec(text);
    if (m) return { kind, m };
  }
  return null;
}

/** The lines the selection touches (a selection that ends at the very start of a line does not take that line). */
function selectedLines(state: EditorState): Line[] {
  const out = new Map<number, Line>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from);
    let last = state.doc.lineAt(r.to);
    if (r.to > r.from && r.to === last.from && last.number > first.number) last = state.doc.lineAt(r.to - 1);
    for (let n = first.number; n <= last.number; n++) out.set(n, state.doc.line(n));
  }
  return [...out.values()];
}

/** Blank lines are left alone in a multi-line selection, unless every line is blank (a cursor on an empty line). */
function targets(state: EditorState): Line[] {
  const lines = selectedLines(state);
  const filled = lines.filter((l) => l.text.trim());
  return filled.length ? filled : lines;
}

const lineSpec = (state: EditorState, changes: { from: number; to: number; insert: string }[]): TransactionSpec => {
  const cs = state.changes(changes);
  return { changes: cs, selection: state.selection.map(cs, 1) };
};

/** `# `, `## `, `### ` before the lines; the same level again, or `level` 0, makes them paragraphs. */
export function setHeading(level: 0 | 1 | 2 | 3): Command {
  return (state) => {
    const lines = targets(state);
    const levelOf = (l: Line) => HEADING.exec(l.text)?.[1]?.length ?? 0;
    const next = level > 0 && lines.every((l) => levelOf(l) === level) ? 0 : level;
    return lineSpec(
      state,
      lines.map((l) => ({ from: l.from, to: l.from + (HEADING.exec(l.text)?.[0].length ?? 0), insert: next ? `${"#".repeat(next)} ` : "" })),
    );
  };
}

/** Bulleted, numbered or checklist items per line; turns another list kind into this one, and takes it off when every line already has it. */
export function toggleList(kind: ListKind): Command {
  return (state) => {
    const lines = targets(state);
    const remove = lines.every((l) => listOf(l.text)?.kind === kind);
    let n = 1;
    return lineSpec(
      state,
      lines.map((l) => {
        const cur = listOf(l.text);
        const indent = cur ? (cur.m[1] ?? "") : (/^\s*/.exec(l.text)?.[0] ?? "");
        const prefix = remove ? "" : kind === "bullet" ? "- " : kind === "task" ? "- [ ] " : `${n++}. `;
        return { from: l.from + indent.length, to: l.from + (cur ? cur.m[0].length : indent.length), insert: prefix };
      }),
    );
  };
}

/** `> ` before the lines, or off when every line has it. */
export const toggleQuote: Command = (state) => {
  const lines = targets(state);
  const remove = lines.every((l) => QUOTE.test(l.text));
  return lineSpec(
    state,
    lines.map((l) => {
      const m = QUOTE.exec(l.text);
      return remove && m ? { from: l.from, to: l.from + m[0].length, insert: m[1] ?? "" } : { from: l.from, to: l.from, insert: m ? "" : "> " };
    }),
  );
};

// ---------------------------------------------------------------- blocks and insertions

/**
 * Put `text` on its own, between blank lines, on the cursor's line (an empty line is used up, otherwise it goes after it).
 * `select` is a range of `text` to select afterwards; without it the cursor goes after the block. Uses the main selection.
 */
function block(state: EditorState, text: string, select?: [number, number]): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.to);
  const empty = !line.text.trim();
  const prev = line.number > 1 ? state.doc.line(line.number - 1) : null;
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
  const lead = empty ? (prev?.text.trim() ? "\n" : "") : "\n\n";
  const tail = !next || next.text.trim() ? "\n" : "";
  const from = empty ? line.from : line.to;
  const at = from + lead.length;
  return {
    changes: { from, to: line.to, insert: lead + text + tail },
    selection: select ? EditorSelection.range(at + select[0], at + select[1]) : EditorSelection.cursor(at + text.length + tail.length),
    scrollIntoView: true,
  };
}

export const insertRule: Command = (state) => block(state, "---");

const TABLE = ["| Column 1 | Column 2 | Column 3 |", "| --- | --- | --- |", "|  |  |  |", "|  |  |  |"].join("\n");

/** A table of three columns: a header and two empty rows, with the first title selected. */
export const insertTable: Command = (state) => block(state, TABLE, [2, 10]);

/** Fence the selected lines, take the fence off when the cursor is already in a code block, or start an empty block. */
export const toggleCodeBlock = (placeholder = "code"): Command => (state) => {
  const r = state.selection.main;
  const fenced = enclosing(state, r.from, r.to, "FencedCode");
  if (fenced) {
    const first = state.doc.lineAt(fenced.from);
    const last = state.doc.lineAt(fenced.to);
    const closed = last.number > first.number && /^\s*(```|~~~)\s*$/.test(last.text);
    const changes = state.changes([
      { from: first.from, to: Math.min(first.to + 1, state.doc.length), insert: "" },
      ...(closed ? [{ from: last.from - 1, to: last.to, insert: "" }] : []),
    ]);
    return { changes, selection: state.selection.map(changes, 1) };
  }
  if (r.empty) return block(state, `\`\`\`\n${placeholder}\n\`\`\``, [4, 4 + placeholder.length]);
  const first = state.doc.lineAt(r.from);
  const last = state.doc.lineAt(r.to > r.from && r.to === state.doc.lineAt(r.to).from ? r.to - 1 : r.to);
  const changes = state.changes([{ from: first.from, insert: "```\n" }, { from: last.to, insert: "\n```" }]);
  return { changes, selection: EditorSelection.range(first.from + 4, last.to + 4), scrollIntoView: true };
};

export type CalloutType = "note" | "tip" | "warning" | "danger" | "question";

/** `> [!type] Title`: a new callout with its title selected, or the selected lines turned into the body of one. */
export const insertCallout = (type: CalloutType, title = "Title"): Command => (state) => {
  const head = `> [!${type}] ${title}`;
  const r = state.selection.main;
  if (r.empty) return block(state, head, [head.length - title.length, head.length]);
  const lines = selectedLines(state).filter((l) => l.text.trim());
  const first = lines[0];
  if (!first) return block(state, head, [head.length - title.length, head.length]);
  const changes = state.changes([
    { from: first.from, insert: `${head}\n` },
    ...lines.filter((l) => !QUOTE.test(l.text)).map((l) => ({ from: l.from, insert: "> " })),
  ]);
  return { changes, selection: EditorSelection.range(first.from + head.length - title.length, first.from + head.length), scrollIntoView: true };
};

/** `[text](url)` around the selection (or a placeholder), or a new address for the link the cursor is in. */
export const insertLink = (url: string, placeholder = "link text"): Command => (state) => {
  const href = url.trim().replace(/ /g, "%20");
  return state.changeByRange((range) => {
    const link = enclosing(state, range.from, range.to, "Link");
    const urlNode = link?.getChild("URL");
    if (urlNode) {
      const changes = state.changes({ from: urlNode.from, to: urlNode.to, insert: href });
      return { changes, range: range.map(changes, 1) };
    }
    const label = state.sliceDoc(range.from, range.to) || placeholder;
    const insert = `[${label}](${href})`;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length) };
  });
};

/** The address of the link the cursor is in, for the link popover. */
export function linkUrlAt(state: EditorState): string {
  const r = state.selection.main;
  const link = enclosing(state, r.from, r.to, "Link");
  const u = link?.getChild("URL");
  return u ? state.sliceDoc(u.from, u.to) : "";
}

/** `[[id]]` or `[[id|type]]` after the selection. */
export const insertNoteLink = (id: string, type?: string): Command => (state) => {
  const insert = `[[${id}${type ? `|${type}` : ""}]]`;
  return state.changeByRange((range) => ({ changes: { from: range.to, insert }, range: EditorSelection.cursor(range.to + insert.length) }));
};

/** Plain text at the cursor, replacing the selection. */
export const insertText = (text: string): Command => (state) =>
  state.changeByRange((range) => ({ changes: { from: range.from, to: range.to, insert: text }, range: EditorSelection.cursor(range.from + text.length) }));

/** An `@` where a mention can start (after a space or at a line start): the `@` completion takes over from there. */
export const insertMentionTrigger: Command = (state) =>
  state.changeByRange((range) => {
    const before = range.from > 0 ? state.sliceDoc(range.from - 1, range.from) : "\n";
    const insert = /\s/.test(before) ? "@" : " @";
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length) };
  });

// ---------------------------------------------------------------- what is active

/** The formats the main cursor or selection is in, for the toolbar's pressed states. */
export function activeFormats(state: EditorState): Set<Format> {
  const out = new Set<Format>();
  const r = state.selection.main;
  for (const k of Object.keys(INLINE) as Inline[]) if (enclosing(state, r.from, r.to, INLINE[k].node)) out.add(k);
  if (enclosing(state, r.from, r.to, "Link")?.getChild("URL")) out.add("link");
  if (enclosing(state, r.from, r.to, "FencedCode")) out.add("codeblock");
  const text = state.doc.lineAt(r.head).text;
  const h = HEADING.exec(text)?.[1]?.length;
  if (h && h <= 3) out.add(`h${h}` as Format);
  const list = listOf(text);
  if (list) out.add(list.kind);
  if (QUOTE.test(text)) out.add("quote");
  return out;
}
