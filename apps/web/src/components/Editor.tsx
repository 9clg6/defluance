"use client";

import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import type { Awareness } from "@/hooks/use-collab";
import { api, qs, uploadFile } from "@/lib/api";
import type { NoteSummary, SearchHit } from "@/lib/types";

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

/**
 * `collab` binds the editor to a shared document: remote cursors, and an undo that only undoes your own changes.
 * Without it the editor owns the text after mount, as before.
 */
/** Files a person can drop or paste into a note: what the server accepts. */
const attachable = (f: File) => /^image\/(png|jpeg|gif|webp)$|^application\/pdf$/.test(f.type);

export function Editor({ value, onChange, onSave, linkTypes, label, collab, readOnly = false, noteId, onError }: { noteId?: string; onError?: (e: unknown) => void; value: string; onChange: (v: string) => void; onSave: () => void; linkTypes: string[]; label: string; collab?: { text: Y.Text; awareness: Awareness }; readOnly?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  const noteRef = useRef(noteId);
  const errorRef = useRef(onError);
  noteRef.current = noteId;
  errorRef.current = onError;

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
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: collab ? collab.text.toString() : value,
        extensions: [
          lineNumbers(),
          ...(collab ? [yCollab(collab.text, collab.awareness, { undoManager: new Y.UndoManager(collab.text) })] : [history()]),
          ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
          drawSelection(),
          highlightActiveLine(),
          markdown(),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          EditorView.domEventHandlers({
            paste: (e, view) => takeFiles(e.clipboardData?.files, e, view),
            drop: (e, view) => takeFiles(e.dataTransfer?.files, e, view),
          }),
          autocompletion({ override: [wikilinkSource(linkTypes)] }),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (onSaveRef.current(), true) },
            ...defaultKeymap,
            ...(collab ? yUndoManagerKeymap : historyKeymap),
          ]),
          EditorView.contentAttributes.of({ "aria-label": label, "aria-multiline": "true" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.destroy();
    // The editor owns the text after mount: remount with a new `key` to load other content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="min-h-[24rem]" />;
}
