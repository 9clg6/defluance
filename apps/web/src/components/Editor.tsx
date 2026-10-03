"use client";

import { autocompletion, type CompletionContext, type CompletionResult, startCompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import { EditorToolbar, type Panel, type ToolbarActions } from "@/components/EditorToolbar";
import type { Awareness } from "@/hooks/use-collab";
import { api, qs, uploadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { bodyStart, EN_LIVE, type LiveLabels, livePreview } from "@/lib/live-preview";
import * as md from "@/lib/markdown-commands";
import { type GhLabels, ghOption, parseMention } from "@/lib/mention";
import type { GhNode, NoteSummary, SearchHit } from "@/lib/types";

/**
 * The completion popup in the app's colours. CodeMirror's own theme gives it a light background with a selector more
 * specific than a stylesheet rule, so a stylesheet left the text of the app (light in dark mode) on white: one option
 * visible, the others unreadable. A theme extension comes later in the cascade at equal specificity.
 */
const popupTheme = EditorView.theme({
  ".cm-tooltip": { backgroundColor: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: "0.75rem", boxShadow: "0 10px 30px rgb(0 0 0 / 0.3)", overflow: "hidden" },
  ".cm-tooltip.cm-tooltip-autocomplete": { maxWidth: "min(42rem, 92vw)" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-sans)", fontSize: "0.9rem", maxHeight: "17rem", padding: "0.25rem" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { display: "flex", alignItems: "baseline", gap: "0.75rem", padding: "0.4rem 0.6rem", borderRadius: "0.5rem", lineHeight: 1.35, color: "var(--foreground)" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--primary)", color: "var(--primary-foreground)" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li > .cm-completionIcon": { display: "none" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li > .cm-completionLabel": { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li > .cm-completionDetail": { flex: "0 0 auto", fontStyle: "normal", fontSize: "0.78rem", marginLeft: 0, color: "var(--muted-foreground)", opacity: 1 },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] > .cm-completionDetail": { color: "inherit", opacity: 0.85 },
});

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "700", color: "var(--primary)" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "var(--primary)" },
  { tag: tags.monospace, color: "var(--muted-foreground)" },
  { tag: tags.processingInstruction, color: "var(--muted-foreground)" },
]);

interface Known {
  id: string;
  title: string;
}

let knownCache: { at: number; notes: Known[] } | undefined;

async function knownNotes(): Promise<Known[]> {
  if (knownCache && Date.now() - knownCache.at < 30_000) return knownCache.notes;
  const page = await api.get<{ items: NoteSummary[] }>(`/api/v1/notes${qs({ sort: "updated", limit: 200 })}`);
  knownCache = { at: Date.now(), notes: page.items.map((n) => ({ id: n.id, title: n.title })) };
  return knownCache.notes;
}

/**
 * Notes matching what was typed after `[[`: by path or title first (what people type), then by content.
 * Exported for tests.
 */
export async function suggestNotes(q: string, limit = 8): Promise<{ label: string; detail: string }[]> {
  const notes = await knownNotes();
  if (!q) return notes.slice(0, limit).map((n) => ({ label: n.id, detail: n.title }));
  const needle = q.toLowerCase();
  const rank = (n: Known) => {
    const id = n.id.toLowerCase();
    const title = n.title.toLowerCase();
    return id.startsWith(needle) ? 0 : title.startsWith(needle) ? 1 : id.includes(needle) ? 2 : title.includes(needle) ? 3 : 9;
  };
  const byName = notes
    .map((n) => ({ n, r: rank(n) }))
    .filter((x) => x.r < 9)
    .sort((a, b) => a.r - b.r || a.n.id.localeCompare(b.n.id))
    .map((x) => ({ label: x.n.id, detail: x.n.title }));
  if (byName.length >= limit || q.length < 3) return byName.slice(0, limit);
  const seen = new Set(byName.map((o) => o.label));
  const byContent = (await api.get<SearchHit[]>(`/api/v1/search${qs({ q, limit })}`)).filter((h) => !seen.has(h.note.id)).map((h) => ({ label: h.note.id, detail: h.note.title }));
  return [...byName, ...byContent].slice(0, limit);
}

/** `[[` suggests notes, `[[note|` suggests link types. */
export function wikilinkSource(linkTypes: string[]) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const before = ctx.matchBefore(/\[\[[^\]\n]*$/);
    if (!before) return null;
    const typed = before.text.slice(2);
    const bar = typed.indexOf("|");
    if (bar !== -1) {
      const from = before.from + 2 + bar + 1;
      return { from, options: linkTypes.map((label) => ({ label, type: "keyword" })), validFor: /^\w*$/ };
    }
    const q = typed.replace(/#.*$/, "").trim();
    let options: { label: string; detail: string }[];
    try {
      options = await suggestNotes(q);
    } catch {
      return null;
    }
    return {
      from: before.from + 2,
      filter: false,
      options: options.map((o) => ({
        label: o.label,
        detail: o.detail,
        type: "text",
        apply: (view, _c, from, to) => {
          const closed = view.state.sliceDoc(to, to + 2) === "]]";
          const insert = closed ? o.label : `${o.label}]]`;
          view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + (closed ? 2 : 0) } });
        },
      })),
    };
  };
}

/** What the connector says: is it on, and is any repository linked (to a space, the default list, or as a public one). */
interface GhState {
  configured: boolean;
  linked: boolean;
}

let ghState: { at: number; s: GhState } | undefined;
const ghCache = new Map<string, { at: number; items: GhNode[] }>();

/** Forget what was fetched (tests). */
export function resetGithubCache() {
  ghState = undefined;
  ghCache.clear();
}

/** Asked once, then remembered for a minute. Null when the call fails (nothing is remembered). */
async function githubStatus(): Promise<GhState | null> {
  if (ghState && Date.now() - ghState.at < 60_000) return ghState.s;
  try {
    const s = await api.get<{ configured: boolean; defaultRepos?: string[]; spaces?: { repos: string[] }[]; publicRepos?: string[] }>("/api/v1/github/status");
    const linked = !!(s.defaultRepos?.length || s.publicRepos?.length || s.spaces?.some((sp) => sp.repos.length));
    ghState = { at: Date.now(), s: { configured: s.configured, linked } };
    return ghState.s;
  } catch {
    return null;
  }
}

async function githubItems(params: { q: string; kind?: GhNode["kind"] | undefined }, limit = 8): Promise<GhNode[]> {
  const url = `/api/v1/github/items${qs({ q: params.q, kind: params.kind, limit })}`;
  const hit = ghCache.get(url);
  if (hit && Date.now() - hit.at < 30_000) return hit.items;
  const { items } = await api.get<{ items: GhNode[] }>(url);
  ghCache.set(url, { at: Date.now(), items });
  return items;
}

/** What the `@` popup says when there is nothing to pick. */
export interface MentionNotes {
  notConnected: string;
  noRepo: string;
  noMatch: string;
  /** Shown beside `noRepo` for an admin, who can act on it: choosing it opens Settings. */
  openSettings?: { label: string; open: () => void };
}

const EN_NOTES: MentionNotes = { notConnected: "GitHub is not connected", noRepo: "No GitHub repository linked yet: link one in Settings > GitHub", noMatch: "No issue or pull request matches" };

/**
 * `@` at the start of a line or after a space suggests GitHub issues and pull requests (`@pr`, `@issue`, or words, or a
 * number). Choosing one inserts `[[gh:owner/repo#12]]`: the `[[` completion offers link types after a `|`.
 * When there is nothing to suggest it says why in one option (GitHub off, no repository linked, no match) instead of staying silent.
 */
export function mentionSource(labels: () => GhLabels, debounceMs = 200, notes: () => MentionNotes = () => EN_NOTES) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const m = parseMention(line.text.slice(0, ctx.pos - line.from));
    if (!m) return null;
    // One request per pause in typing: the next keystroke aborts this one.
    await new Promise<void>((r) => setTimeout(r, debounceMs));
    if (ctx.aborted) return null;
    const from = line.from + m.from;
    const say = (label: string, action?: { label: string; open: () => void }): CompletionResult => ({
      from,
      filter: false,
      options: [{ label, detail: action?.label, type: "info", apply: () => action?.open() }],
    });
    let items: GhNode[];
    try {
      const st = await githubStatus();
      if (!st) return null;
      if (ctx.aborted) return null;
      if (!st.configured) return say(notes().notConnected);
      if (!st.linked) return say(notes().noRepo, notes().openSettings);
      items = await githubItems(m);
    } catch {
      return null;
    }
    if (ctx.aborted) return null;
    if (!items.length) return say(notes().noMatch);
    return {
      from,
      filter: false,
      options: items.map((n) => {
        const o = ghOption(n, labels());
        return {
          label: o.label,
          detail: o.detail,
          type: "text",
          apply: (view, _c, from, to) => view.dispatch({ changes: { from, to, insert: o.insert }, selection: { anchor: from + o.insert.length } }),
        };
      }),
    };
  };
}

/** Files a person can drop or paste into a note: what the server accepts. */
const attachable = (f: File) => /^image\/(png|jpeg|gif|webp)$|^application\/pdf$/.test(f.type);

const PREVIEW_KEY = "dfl-live-preview";
/** Live preview is on unless the person turned it off in this browser. */
export function readPreview(): boolean {
  try {
    return localStorage.getItem(PREVIEW_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * `collab` binds the editor to a shared document: remote cursors, and an undo that only undoes your own changes.
 * Without it the editor owns the text after mount, as before. The text is Markdown all the way down: the toolbar and the
 * live preview only dispatch ordinary transactions and decorations.
 */
export function Editor({ value, onChange, onSave, linkTypes, label, collab, readOnly = false, noteId, onError, side, onLivePreview }: { side?: { on: boolean; toggle: () => void }; onLivePreview?: (on: boolean) => void; noteId?: string; onError?: (e: unknown) => void; value: string; onChange: (v: string) => void; onSave: () => void; linkTypes: string[]; label: string; collab?: { text: Y.Text; awareness: Awareness }; readOnly?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const { t } = useT();
  const { me } = useAuth();
  const isAdmin = !!me?.spaces.some((s) => s.perms.includes("admin"));
  const labelsRef = useRef<GhLabels>({ pr: "PR", issue: "issue", state: (s) => s });
  labelsRef.current = { pr: t("gh.pr"), issue: t("gh.issue"), state: (s) => t(`gh.${s}`) };
  const notesRef = useRef<MentionNotes>({ notConnected: "", noRepo: "", noMatch: "" });
  notesRef.current = {
    notConnected: t("gh.mention.notConnected"),
    noRepo: t("gh.mention.noRepo"),
    noMatch: t("gh.mention.noMatch"),
    ...(isAdmin ? { openSettings: { label: t("gh.mention.open"), open: () => void window.open("/settings/?tab=github", "_blank", "noopener") } } : {}),
  };
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  const noteRef = useRef(noteId);
  const errorRef = useRef(onError);
  const onLivePreviewRef = useRef(onLivePreview);
  onLivePreviewRef.current = onLivePreview;
  noteRef.current = noteId;
  errorRef.current = onError;

  const [view, setView] = useState<EditorView | null>(null);
  const [active, setActive] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [preview, setPreviewState] = useState(readPreview);
  const previewRef = useRef(preview);
  const previewSlot = useRef(new Compartment());
  const panelRef = useRef(setPanel);
  const textLabels = useRef<LiveLabels>(EN_LIVE);
  textLabels.current = { properties: (n) => t("editor.properties", { n }), propertiesOpen: (n) => t("editor.propertiesOpen", { n }), task: t("editor.task") };
  const collabRef = useRef(!!collab);

  const setPreview = useCallback((on: boolean) => {
    previewRef.current = on;
    setPreviewState(on);
    onLivePreviewRef.current?.(on);
    try {
      localStorage.setItem(PREVIEW_KEY, on ? "on" : "off");
    } catch {
      // the choice lasts for this page only
    }
  }, []);

  // Turning the preview on or off swaps one extension; the document, selection and history are untouched.
  useEffect(() => {
    view?.dispatch({ effects: previewSlot.current.reconfigure(preview ? livePreview(() => textLabels.current) : []) });
  }, [view, preview]);

  /** Run a formatting command on the editor: one ordinary transaction. */
  const run = useCallback((cmd: md.Command) => {
    const v = viewRef.current;
    if (!v || v.state.readOnly) return false;
    v.dispatch({ ...cmd(v.state), scrollIntoView: true });
    v.focus();
    return true;
  }, []);
  const viewRef = useRef<EditorView | null>(null);
  viewRef.current = view;

  const actions = useMemo<ToolbarActions>(() => {
    const ph = {
      bold: t("editor.ph.bold"),
      italic: t("editor.ph.italic"),
      strike: t("editor.ph.strike"),
      code: t("editor.ph.code"),
    };
    return {
      bold: () => run(md.toggleInline("bold", ph.bold)),
      italic: () => run(md.toggleInline("italic", ph.italic)),
      strike: () => run(md.toggleInline("strike", ph.strike)),
      code: () => run(md.toggleInline("code", ph.code)),
      heading: (n) => run(md.setHeading(n)),
      bullets: () => run(md.toggleList("bullet")),
      numbers: () => run(md.toggleList("numbered")),
      checklist: () => run(md.toggleList("task")),
      quote: () => run(md.toggleQuote),
      codeBlock: () => run(md.toggleCodeBlock(t("editor.ph.code"))),
      table: () => run(md.insertTable),
      rule: () => run(md.insertRule),
      callout: (type) => run(md.insertCallout(type, t("editor.ph.title"))),
      mention: () => {
        if (run(md.insertMentionTrigger) && viewRef.current) startCompletion(viewRef.current);
      },
      undo: () => {
        const v = viewRef.current;
        if (!v) return;
        if (collabRef.current) yUndoManagerKeymap.find((k) => k.key === "Mod-z")?.run?.(v);
        else undo(v);
        v.focus();
      },
      redo: () => {
        const v = viewRef.current;
        if (!v) return;
        if (collabRef.current) yUndoManagerKeymap.find((k) => k.key === "Mod-Shift-z")?.run?.(v);
        else redo(v);
        v.focus();
      },
      link: (url) => run(md.insertLink(url, t("editor.ph.link"))),
      noteLink: (id, type) => run(md.insertNoteLink(id, type)),
      upload: (file) => {
        const note = noteRef.current;
        if (!note || !attachable(file)) return;
        void uploadFile(note, file).then(
          (up) => run(md.insertText(`${up.markdown}\n`)),
          (err) => errorRef.current?.(err),
        );
      },
    };
  }, [run, t]);

  useEffect(() => {
    if (!host.current) return;
    /** Upload dropped or pasted files and put their markdown where the cursor is. Other content is left to the editor. */
    const takeFiles = (list: FileList | null | undefined, e: Event, view: EditorView) => {
      const files = [...(list ?? [])].filter(attachable);
      const note = noteRef.current;
      if (!files.length || !note || readOnly) return false;
      e.preventDefault();
      void (async () => {
        for (const f of files) {
          try {
            const up = await uploadFile(note, f);
            const at = view.state.selection.main.head;
            view.dispatch({ changes: { from: at, insert: `${up.markdown}\n` }, selection: { anchor: at + up.markdown.length + 1 } });
          } catch (err) {
            errorRef.current?.(err);
          }
        }
      })();
      return true;
    };
    const fmt = (cmd: md.Command) => () => run(cmd);
    const doc = collab ? collab.text.toString() : value;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc,
        // With the preview on, open with the cursor below the frontmatter, so it starts collapsed.
        ...(previewRef.current ? { selection: EditorSelection.cursor(bodyStart(EditorState.create({ doc }))) } : {}),
        extensions: [
          lineNumbers(),
          ...(collab ? [yCollab(collab.text, collab.awareness, { undoManager: new Y.UndoManager(collab.text) })] : [history()]),
          ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
          drawSelection(),
          highlightActiveLine(),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          popupTheme,
          previewSlot.current.of(previewRef.current ? livePreview(() => textLabels.current) : []),
          EditorView.domEventHandlers({
            paste: (e, view) => takeFiles(e.clipboardData?.files, e, view),
            drop: (e, view) => takeFiles(e.dataTransfer?.files, e, view),
          }),
          autocompletion({ override: [wikilinkSource(linkTypes), mentionSource(() => labelsRef.current, 200, () => notesRef.current)] }),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (onSaveRef.current(), true) },
            { key: "Mod-b", run: fmt(md.toggleInline("bold")), preventDefault: true },
            { key: "Mod-i", run: fmt(md.toggleInline("italic")), preventDefault: true },
            { key: "Mod-e", run: fmt(md.toggleInline("code")), preventDefault: true },
            { key: "Mod-Shift-x", run: fmt(md.toggleInline("strike")), preventDefault: true },
            { key: "Mod-k", run: (view) => (setLinkUrl(md.linkUrlAt(view.state)), panelRef.current("link"), true), preventDefault: true },
            { key: "Mod-Alt-1", run: fmt(md.setHeading(1)), preventDefault: true },
            { key: "Mod-Alt-2", run: fmt(md.setHeading(2)), preventDefault: true },
            { key: "Mod-Alt-3", run: fmt(md.setHeading(3)), preventDefault: true },
            { key: "Mod-Shift-7", run: fmt(md.toggleList("numbered")), preventDefault: true },
            { key: "Mod-Shift-8", run: fmt(md.toggleList("bullet")), preventDefault: true },
            { key: "Mod-Shift-9", run: fmt(md.toggleList("task")), preventDefault: true },
            ...defaultKeymap,
            ...(collab ? yUndoManagerKeymap : historyKeymap),
          ]),
          EditorView.contentAttributes.of({ "aria-label": label, "aria-multiline": "true" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
            if (u.docChanged || u.selectionSet) setActive([...md.activeFormats(u.state)].sort().join(","));
          }),
        ],
      }),
    });
    setView(v);
    return () => {
      v.destroy();
      setView(null);
    };
    // The editor owns the text after mount: remount with a new `key` to load other content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suggest = useCallback((q: string) => suggestNotes(q), []);
  const formats = useMemo(() => new Set(active ? (active.split(",") as md.Format[]) : []), [active]);

  return (
    <div className="min-w-0">
      <EditorToolbar
        active={formats}
        disabled={readOnly}
        actions={actions}
        panel={panel}
        setPanel={(p) => {
          if (p === "link" && view) setLinkUrl(md.linkUrlAt(view.state));
          setPanel(p);
        }}
        linkUrl={linkUrl}
        preview={preview}
        setPreview={setPreview}
        side={side}
        suggest={suggest}
        linkTypes={linkTypes}
        canUpload={!!noteId}
      />
      <div ref={host} className="min-h-[24rem]" />
      <p className="mt-1.5 text-xs text-muted-foreground">{t("editor.hint")}</p>
    </div>
  );
}
