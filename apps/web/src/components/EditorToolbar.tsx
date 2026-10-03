"use client";

import { Bold, Code, FileCode, GitPullRequest, PanelRight, Italic, Link as LinkIcon, Link2, List, ListChecks, ListOrdered, Minus, Quote, Redo2, SquareCode, Strikethrough, Table, Undo2, Image as ImageIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { CalloutType, Format } from "@/lib/markdown-commands";

export const CALLOUTS: CalloutType[] = ["note", "tip", "warning", "danger", "question"];

export type Panel = "link" | "note" | null;

export interface ToolbarActions {
  bold(): void;
  italic(): void;
  strike(): void;
  heading(level: 0 | 1 | 2 | 3): void;
  bullets(): void;
  numbers(): void;
  checklist(): void;
  quote(): void;
  code(): void;
  codeBlock(): void;
  table(): void;
  rule(): void;
  callout(type: CalloutType): void;
  mention(): void;
  undo(): void;
  redo(): void;
  link(url: string): void;
  noteLink(id: string, type?: string): void;
  upload(file: File): void;
}

const modKey = () => (typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+");

/** A toolbar button: named for screen readers, with a tooltip that shows on hover and on keyboard focus. */
function Tb({ label, shortcut, pressed, disabled, onClick, children }: { label: string; shortcut?: string; pressed?: boolean; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      data-tip={shortcut ? `${label} (${shortcut.replace("Mod+", modKey())})` : label}
      disabled={disabled}
      // The editor keeps the focus and the selection: the command acts on them.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="dfl-tb-btn"
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-0.5 h-5 w-px self-center bg-border" aria-hidden />;

/**
 * Formatting toolbar for the editor. It only calls `actions`: every one of them is a CodeMirror transaction, so the shared
 * text (Yjs) and the undo history see ordinary edits. `active` says which formats the cursor is in.
 */
export function EditorToolbar({ active, disabled, actions, panel, setPanel, linkUrl, preview, setPreview, side, suggest, linkTypes, canUpload }: {
  active: ReadonlySet<Format>;
  disabled: boolean;
  actions: ToolbarActions;
  panel: Panel;
  setPanel: (p: Panel) => void;
  /** The address of the link under the cursor, to edit it. */
  linkUrl: string;
  preview: boolean;
  setPreview: (v: boolean) => void;
  /** The Preview button: the rendered note beside the editor. */
  side?: { on: boolean; toggle: () => void };
  suggest: (q: string) => Promise<{ label: string; detail: string }[]>;
  linkTypes: string[];
  canUpload: boolean;
}) {
  const { t } = useT();
  const file = useRef<HTMLInputElement>(null);
  const on = (f: Format) => active.has(f);
  const heading = on("h1") ? "1" : on("h2") ? "2" : on("h3") ? "3" : "0";
  const btn = { disabled };

  return (
    <div className="mb-2 space-y-2">
      <div role="toolbar" aria-label={t("editor.toolbar")} className="dfl-toolbar flex flex-wrap items-center gap-1 rounded-[var(--arc-radius-control)] border bg-card p-1">
        <Select aria-label={t("editor.heading")} disabled={disabled} value={heading} onChange={(e) => actions.heading(Number(e.target.value) as 0 | 1 | 2 | 3)} className="!h-8 !w-auto !px-2 !pr-7 text-xs">
          <option value="0">{t("editor.paragraph")}</option>
          <option value="1">{t("editor.h1")}</option>
          <option value="2">{t("editor.h2")}</option>
          <option value="3">{t("editor.h3")}</option>
        </Select>
        <Sep />
        <Tb label={t("editor.bold")} shortcut="Mod+B" pressed={on("bold")} onClick={actions.bold} {...btn}><Bold className="size-4" aria-hidden /></Tb>
        <Tb label={t("editor.italic")} shortcut="Mod+I" pressed={on("italic")} onClick={actions.italic} {...btn}><Italic className="size-4" aria-hidden /></Tb>
        <Tb label={t("editor.strike")} shortcut="Mod+Shift+X" pressed={on("strike")} onClick={actions.strike} {...btn}><Strikethrough className="size-4" aria-hidden /></Tb>
        <Tb label={t("editor.code")} shortcut="Mod+E" pressed={on("code")} onClick={actions.code} {...btn}><Code className="size-4" aria-hidden /></Tb>
        <Sep />
        <Tb label={t("editor.bullets")} shortcut="Mod+Shift+8" pressed={on("bullet")} onClick={actions.bullets} {...btn}><List className="size-4" aria-hidden /></Tb>
        <Tb label={t("editor.numbers")} shortcut="Mod+Shift+7" pressed={on("numbered")} onClick={actions.numbers} {...btn}><ListOrdered className="size-4" aria-hidden /></Tb>
        <Tb label={t("editor.checklist")} shortcut="Mod+Shift+9" pressed={on("task")} onClick={actions.checklist} {...btn}><ListChecks className="size-4" aria-hidden /></Tb>
        <Tb label={t("editor.quote")} pressed={on("quote")} onClick={actions.quote} {...btn}><Quote className="size-4" aria-hidden /></Tb>
        <Tb label={t("editor.codeBlock")} pressed={on("codeblock")} onClick={actions.codeBlock} {...btn}><SquareCode className="size-4" aria-hidden /></Tb>
        <Sep />
        <Tb label={t("editor.link")} shortcut="Mod+K" pressed={on("link")} onClick={() => setPanel(panel === "link" ? null : "link")} {...btn}><LinkIcon className="size-4" aria-hidden /></Tb>
        <Tb label={t("editor.noteLink")} onClick={() => setPanel(panel === "note" ? null : "note")} {...btn}><Link2 className="size-4" aria-hidden /></Tb>
        <Tb label={t("editor.github")} onClick={actions.mention} {...btn}><GitPullRequest className="size-4" aria-hidden /></Tb>
        <Tb label={t("editor.image")} onClick={() => file.current?.click()} disabled={disabled || !canUpload}><ImageIcon className="size-4" aria-hidden /></Tb>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
          className="hidden"
          tabIndex={-1}
          aria-hidden
          data-testid="editor-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) actions.upload(f);
          }}
        />
        <Sep />
        <Tb label={t("editor.table")} onClick={actions.table} {...btn}><Table className="size-4" aria-hidden /></Tb>
        <Tb label={t("editor.rule")} onClick={actions.rule} {...btn}><Minus className="size-4" aria-hidden /></Tb>
        <Select
          aria-label={t("editor.callout")}
          disabled={disabled}
          value=""
          onChange={(e) => e.target.value && actions.callout(e.target.value as CalloutType)}
          className="!h-8 !w-auto !px-2 !pr-7 text-xs"
        >
          <option value="">{t("editor.callout")}</option>
          {CALLOUTS.map((c) => <option key={c} value={c}>{t(`editor.callout.${c}`)}</option>)}
        </Select>
        <Sep />
        <Tb label={t("editor.undo")} shortcut="Mod+Z" onClick={actions.undo} {...btn}><Undo2 className="size-4" aria-hidden /></Tb>
        <Tb label={t("editor.redo")} shortcut="Mod+Shift+Z" onClick={actions.redo} {...btn}><Redo2 className="size-4" aria-hidden /></Tb>
        <span className="ml-auto" />
        {side && <Tb label={t("note.preview")} pressed={side.on} onClick={side.toggle} disabled={false}><PanelRight className="size-4" aria-hidden /></Tb>}
        <Tb label={t("editor.source")} pressed={!preview} onClick={() => setPreview(!preview)} disabled={false}><FileCode className="size-4" aria-hidden /></Tb>
      </div>
      {panel === "link" && <LinkPanel initial={linkUrl} onApply={(u) => { actions.link(u); setPanel(null); }} onClose={() => setPanel(null)} />}
      {panel === "note" && <NotePanel suggest={suggest} linkTypes={linkTypes} onPick={(id, type) => { actions.noteLink(id, type); setPanel(null); }} onClose={() => setPanel(null)} />}
    </div>
  );
}

function LinkPanel({ initial, onApply, onClose }: { initial: string; onApply: (url: string) => void; onClose: () => void }) {
  const { t } = useT();
  const [url, setUrl] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <form
      role="group"
      aria-label={t("editor.linkTitle")}
      className="flex flex-wrap items-center gap-2 rounded-[var(--arc-radius-control)] border bg-card p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) onApply(url);
      }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <Input ref={input} aria-label={t("editor.linkUrl")} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} className="min-w-0 flex-1 basis-56" />
      <Button type="submit" size="sm" disabled={!url.trim()}>{t("editor.linkApply")}</Button>
      <Button variant="outline" size="sm" onClick={onClose}>{t("cancel")}</Button>
    </form>
  );
}

function NotePanel({ suggest, linkTypes, onPick, onClose }: { suggest: (q: string) => Promise<{ label: string; detail: string }[]>; linkTypes: string[]; onPick: (id: string, type?: string) => void; onClose: () => void }) {
  const { t, tr } = useT();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [items, setItems] = useState<{ label: string; detail: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      suggest(q).then((r) => live && setItems(r), () => live && setItems([]));
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, suggest]);
  return (
    <div role="group" aria-label={t("editor.noteTitle")} className="space-y-2 rounded-[var(--arc-radius-control)] border bg-card p-2" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="flex flex-wrap items-center gap-2">
        <Input ref={input} aria-label={t("editor.noteSearch")} value={q} onChange={(e) => setQ(e.target.value)} className="min-w-0 flex-1 basis-56" />
        <Select aria-label={t("editor.noteType")} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t("editor.noteNoType")}</option>
          {linkTypes.map((l) => <option key={l} value={l}>{tr("link", l)}</option>)}
        </Select>
        <Button variant="outline" size="sm" onClick={onClose}>{t("cancel")}</Button>
      </div>
      {items.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{t("editor.noteNone")}</p>
      ) : (
        <ul className="max-h-48 overflow-y-auto" aria-label={t("editor.noteResults")}>
          {items.map((i) => (
            <li key={i.label}>
              <button type="button" className="flex w-full flex-wrap items-baseline gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent focus-visible:bg-accent" onClick={() => onPick(i.label, type || undefined)}>
                <code className="font-medium">{i.label}</code>
                <span className="text-muted-foreground">{i.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
