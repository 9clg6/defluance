import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

// Live preview, the way Obsidian does it: the text is styled as it will look and the Markdown marks are hidden, except on
// the lines the selection touches, where the raw Markdown shows so it can be edited. Only mark, line, replace and widget
// decorations are used: the document is never changed, so the shared text (and what is saved) stays byte-identical.

export interface LiveLabels {
  /** Text of the collapsed frontmatter line. */
  properties: (keys: number) => string;
  /** Accessible name of the collapsed frontmatter line. */
  propertiesOpen: (keys: number) => string;
  /** Accessible name of a task checkbox. */
  task: string;
}

export const EN_LIVE: LiveLabels = { properties: (n) => `Properties (${n})`, propertiesOpen: (n) => `Properties, ${n} keys. Press to edit`, task: "Task" };

type Node = ReturnType<typeof syntaxTree>["topNode"];

// ---------------------------------------------------------------- frontmatter

export interface Frontmatter {
  /** End of the closing `---` line. The block starts at 0. */
  to: number;
  keys: number;
  /** Line numbers (1-based) of the block. */
  lines: number;
}

/** The YAML block at the top of a note: `---` on the first line, the next `---` from the third line on (the server's rule). */
export function frontmatterOf(state: EditorState): Frontmatter | null {
  const doc = state.doc;
  if (doc.lines < 3 || doc.line(1).text !== "---") return null;
  let keys = 0;
  for (let n = 2; n <= Math.min(doc.lines, 400); n++) {
    const text = doc.line(n).text;
    if (n >= 3 && text.replace(/[ \t]+$/, "") === "---") return { to: doc.line(n).to, keys, lines: n };
    if (/^[^\s#:-][^:]*:/.test(text)) keys++;
  }
  return null;
}

/** Where the body starts: just after the frontmatter, so an editor that opens with the cursor there shows it collapsed. */
export function bodyStart(state: EditorState): number {
  const fm = frontmatterOf(state);
  return fm ? Math.min(fm.to + 1, state.doc.length) : 0;
}

/** Line intervals the selection touches: marks on them stay visible. */
function touchedLines(state: EditorState): [number, number][] {
  return state.selection.ranges.map((r) => [state.doc.lineAt(r.from).from, state.doc.lineAt(r.to).to]);
}
const touches = (touched: [number, number][], from: number, to: number) => touched.some(([a, b]) => from <= b && to >= a);

// ---------------------------------------------------------------- widgets

class PropertiesWidget extends WidgetType {
  constructor(readonly keys: number, readonly labels: LiveLabels) {
    super();
  }
  eq(o: PropertiesWidget) {
    return o.keys === this.keys;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-lp-props";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", this.labels.propertiesOpen(this.keys));
    el.textContent = this.labels.properties(this.keys);
    // Put the cursor inside: the block expands to the raw YAML.
    const open = () => {
      view.dispatch({ selection: { anchor: Math.min(view.posAtDOM(el) + 4, view.state.doc.length) } });
      view.focus();
    };
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      open();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
  get estimatedHeight() {
    return 34;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-bullet";
    el.textContent = "•";
    return el;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly label: string, readonly disabled: boolean) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.disabled === this.disabled;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.className = "cm-lp-check";
    el.checked = this.checked;
    el.disabled = this.disabled;
    el.setAttribute("aria-label", this.label);
    // Keep the focus (and the cursor) where they are; the click flips `[ ]` and `[x]` in the text.
    el.addEventListener("mousedown", (e) => e.preventDefault());
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(el);
      const line = view.state.doc.lineAt(pos);
      const at = line.text.indexOf("[", pos - line.from);
      if (at < 0) return;
      view.dispatch({ changes: { from: line.from + at + 1, to: line.from + at + 2, insert: line.text[at + 1] === " " ? "x" : " " } });
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

class ChipWidget extends WidgetType {
  constructor(readonly text: string, readonly title: string) {
    super();
  }
  eq(o: ChipWidget) {
    return o.text === this.text && o.title === this.title;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-chip";
    el.title = this.title;
    el.textContent = this.text;
    return el;
  }
}

const BULLET = new BulletWidget();
const HIDE = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });
const lineDeco = (cls: string) => Decoration.line({ class: cls });

// ---------------------------------------------------------------- the decorations

const WIKILINK = /(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g;
const GH = /^gh:([\w.-]+\/[\w.-]+)#(\d+)$/;
const CALLOUT = /^(\s*>\s*)\[!([\w-]+)\][+-]?(?:\s+(.*))?$/;

export interface Built {
  decorations: DecorationSet;
  /** The hidden parts: the cursor skips over them. */
  atomic: DecorationSet;
}

/**
 * Decorations for `ranges` (the visible parts of the document) given the selection in `state`.
 * Pure: no view needed, so it is tested on a bare state.
 */
export function buildLivePreview(state: EditorState, ranges: readonly { from: number; to: number }[], labels: LiveLabels = EN_LIVE): Built {
  const doc = state.doc;
  const touched = touchedLines(state);
  const out: Range<Decoration>[] = [];
  const atoms: Range<Decoration>[] = [];
  const fm = frontmatterOf(state);
  const tree = ensureSyntaxTree(state, doc.length, 50) ?? syntaxTree(state);

  /** Hide [from, to) unless the selection is on its line. Never across a line break (plugins cannot replace those). */
  const hide = (from: number, to: number) => {
    if (to <= from || touches(touched, from, from) || doc.lineAt(from).to < to) return;
    const r = HIDE.range(from, to);
    out.push(r);
    atoms.push(r);
  };
  const widget = (from: number, to: number, w: WidgetType) => {
    if (touches(touched, from, from)) return;
    const r = Decoration.replace({ widget: w }).range(from, to);
    out.push(r);
    atoms.push(r);
  };
  const markRange = (from: number, to: number, cls: string) => {
    if (to > from) out.push(mark(cls).range(from, to));
  };
  /** A line decoration on each line of [from, to), kept inside `bounds`. */
  const lines = (from: number, to: number, bounds: { from: number; to: number }, cls: (n: number, first: boolean, last: boolean) => string) => {
    const a = doc.lineAt(Math.max(from, bounds.from));
    const b = doc.lineAt(Math.min(to, bounds.to));
    for (let n = a.number; n <= b.number; n++) out.push(lineDeco(cls(n, doc.line(n).from <= from, doc.line(n).to >= to)).range(doc.line(n).from));
  };

  for (const vis of ranges) {
    const start = doc.lineAt(vis.from).from;
    const end = doc.lineAt(vis.to).to;
    const bounds = { from: start, to: end };
    const claimed: [number, number][] = [];

    // The raw frontmatter, once it is open: a quiet background.
    if (fm && touches(touched, 0, fm.to)) lines(0, fm.to, bounds, () => "cm-lp-fm");

    // [[wikilinks]], ![[embeds]] and [[gh:owner/repo#12]] chips: not Markdown, so not in the tree.
    const text = doc.sliceString(start, end);
    for (const m of text.matchAll(WIKILINK)) {
      const from = start + (m.index ?? 0);
      const to = from + m[0].length;
      if (fm && from <= fm.to) continue;
      const inCode = ["InlineCode", "FencedCode", "CodeBlock"].some((n) => {
        for (let x: Node | null = tree.resolveInner(from, 1); x; x = x.parent) if (x.name === n) return true;
        return false;
      });
      if (inCode) continue;
      claimed.push([from, to]);
      const target = m[2] ?? "";
      const gh = GH.exec(target);
      if (m[1]) markRange(from, to, "cm-lp-embed");
      else if (gh) {
        widget(from, to, new ChipWidget(`#${gh[2]}`, `${gh[1]}#${gh[2]}`));
        if (touches(touched, from, from)) markRange(from, to, "cm-lp-wikilink");
      } else {
        const open = from + 2;
        const close = open + target.length;
        hide(from, open);
        markRange(open, close, "cm-lp-wikilink");
        hide(close, to);
      }
    }
    const isClaimed = (from: number, to: number) => claimed.some(([a, b]) => from < b && to > a);

    tree.iterate({
      from: Math.max(vis.from, fm ? fm.to + 1 : 0),
      to: vis.to,
      enter: (n) => {
        const { name, from, to } = n;
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          lines(from, to, bounds, () => `cm-lp-h${Math.min(3, Number(heading[1]))}`);
          return;
        }
        switch (name) {
          case "SetextHeading1":
          case "SetextHeading2":
            lines(from, doc.lineAt(from).to, bounds, () => `cm-lp-h${name.endsWith("1") ? 1 : 2}`);
            return;
          case "HeaderMark":
            if (n.node.parent?.name.startsWith("ATX")) hide(from, doc.sliceString(to, to + 1) === " " ? to + 1 : to);
            return;
          case "StrongEmphasis":
            markRange(from, to, "cm-lp-strong");
            return;
          case "Emphasis":
            markRange(from, to, "cm-lp-em");
            return;
          case "Strikethrough":
            markRange(from, to, "cm-lp-strike");
            return;
          case "InlineCode":
            markRange(from, to, "cm-lp-code-inline");
            return;
          case "EmphasisMark":
          case "StrikethroughMark":
            hide(from, to);
            return;
          case "CodeMark":
            hide(from, to);
            return;
          case "CodeInfo":
            markRange(from, to, "cm-lp-code-info");
            return;
          case "Link": {
            if (isClaimed(from, to)) return false;
            const url = n.node.getChild("URL");
            const marks = n.node.getChildren("LinkMark");
            const open = marks[0];
            const close = marks[1];
            if (!url || !open || !close) return;
            markRange(open.to, close.from, "cm-lp-link");
            hide(open.from, open.to);
            hide(close.from, to);
            return;
          }
          case "Image":
            if (isClaimed(from, to)) return false;
            markRange(from, to, "cm-lp-embed");
            return false;
          case "URL":
            if (!["Link", "Image"].includes(n.node.parent?.name ?? "")) markRange(from, to, "cm-lp-link");
            return;
          case "Blockquote": {
            const first = doc.lineAt(from).text;
            const callout = CALLOUT.exec(first);
            const type = callout ? (callout[2] ?? "note").toLowerCase() : "";
            lines(from, to, bounds, (_n, isFirst) => (callout ? `cm-lp-callout cm-lp-callout-${type}${isFirst ? " cm-lp-callout-first" : ""}` : "cm-lp-quote"));
            if (callout && bounds.from <= from) {
              const at = doc.lineAt(from).from + (callout[1]?.length ?? 0);
              const kind = `[!${callout[2]}]`;
              markRange(at, at + kind.length, "cm-lp-callout-kind");
              const title = callout[3];
              if (title) markRange(doc.lineAt(from).to - title.length, doc.lineAt(from).to, "cm-lp-callout-title");
            }
            return;
          }
          case "QuoteMark":
            hide(from, doc.sliceString(to, to + 1) === " " ? to + 1 : to);
            return;
          case "ListMark": {
            const list = n.node.parent?.parent?.name;
            if (list === "OrderedList") markRange(from, to, "cm-lp-ol");
            else if (list === "BulletList") {
              const task = n.node.nextSibling;
              const marker = task?.name === "Task" ? task.getChild("TaskMarker") : null;
              if (task && marker) {
                const checked = /[xX]/.test(doc.sliceString(marker.from + 1, marker.to - 1));
                widget(from, marker.to, new CheckboxWidget(checked, labels.task, state.readOnly));
                if (checked) markRange(marker.to, doc.lineAt(from).to, "cm-lp-done");
              } else widget(from, to, BULLET);
            }
            return;
          }
          case "HorizontalRule":
            out.push(lineDeco("cm-lp-hr").range(doc.lineAt(from).from));
            hide(from, to);
            return;
          case "FencedCode":
            lines(from, to, bounds, (_n, isFirst, isLast) => `cm-lp-code${isFirst ? " cm-lp-code-first" : ""}${isLast ? " cm-lp-code-last" : ""}`);
            return;
          case "CodeBlock":
            lines(from, to, bounds, () => "cm-lp-code");
            return;
          case "Table":
            lines(from, to, bounds, () => "cm-lp-table");
            return;
        }
      },
    });
  }
  return { decorations: Decoration.set(out, true), atomic: Decoration.set(atoms, true) };
}

/** What a decoration set holds, for tests: `[from, to, kind, class or widget name]`. */
export function listDecorations(set: DecorationSet): [number, number, "hide" | "mark" | "line" | "widget", string][] {
  const out: [number, number, "hide" | "mark" | "line" | "widget", string][] = [];
  for (const it = set.iter(); it.value; it.next()) {
    const v = it.value;
    const spec = v.spec as { class?: string; widget?: WidgetType };
    const widgetName = spec.widget?.constructor.name ?? "";
    out.push([it.from, it.to, spec.widget ? "widget" : it.from === it.to ? "line" : v.point ? "hide" : "mark", spec.widget ? widgetName : (spec.class ?? "")]);
  }
  return out;
}

// ---------------------------------------------------------------- extension

/** The frontmatter as one line. A state field: it replaces line breaks, which a view plugin may not. */
function frontmatterField(labels: () => LiveLabels) {
  const build = (state: EditorState): DecorationSet => {
    const fm = frontmatterOf(state);
    if (!fm || touches(touchedLines(state), 0, fm.to)) return Decoration.none;
    return Decoration.set(Decoration.replace({ widget: new PropertiesWidget(fm.keys, labels()), block: true }).range(0, fm.to));
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (v, tr) => (tr.docChanged || tr.selection ? build(tr.state) : v),
    provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
  });
}

/** What a click on the text at `pos` opens: a web address, a note, or a GitHub issue. Null when it is not a link. */
export function linkAt(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos);
  for (const m of line.text.matchAll(WIKILINK)) {
    const from = line.from + (m.index ?? 0);
    if (pos < from || pos > from + m[0].length) continue;
    const target = m[2] ?? "";
    const gh = GH.exec(target);
    if (gh) return `https://github.com/${gh[1]}/issues/${gh[2]}`;
    return `/n/${target.replace(/#.*$/, "").replace(/\.md$/, "").trim()}/`;
  }
  const t = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  for (let n: Node | null = t.resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "Link" || n.name === "Autolink") {
      const u = n.getChild("URL");
      return u ? state.sliceDoc(u.from, u.to) : null;
    }
    if (n.name === "URL") return state.sliceDoc(n.from, n.to);
  }
  return null;
}

/** Live preview: styled text, hidden marks, Cmd/Ctrl-click on links. Reconfigure with an empty extension to show the raw Markdown. */
export function livePreview(labels: () => LiveLabels = () => EN_LIVE): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      atomic: DecorationSet;
      constructor(view: EditorView) {
        ({ decorations: this.decorations, atomic: this.atomic } = buildLivePreview(view.state, view.visibleRanges, labels()));
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          ({ decorations: this.decorations, atomic: this.atomic } = buildLivePreview(u.state, u.view.visibleRanges, labels()));
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.atomic ?? Decoration.none),
    },
  );
  return [
    frontmatterField(labels),
    plugin,
    EditorView.editorAttributes.of({ class: "cm-live" }),
    EditorView.domEventHandlers({
      click(e, view) {
        if (!(e.metaKey || e.ctrlKey)) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        const href = pos === null ? null : linkAt(view.state, pos);
        if (!href) return false;
        window.open(href, "_blank", "noopener,noreferrer");
        return true;
      },
    }),
  ];
}
