"use client";

import { Command } from "cmdk";
import { CornerDownLeft, FilePlus, MessageCircleQuestion, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StatusBadge, TypeBadge } from "@/components/badges";
import { Dialog, DialogContent, Kbd } from "@/components/ui";
import { notePath } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { ModePicker } from "@/components/ModePicker";
import { Marked } from "@/components/ResultCard";
import { Understood } from "@/components/Understood";
import { useSearch } from "@/hooks/use-search";
import { queryTerms } from "@/lib/highlight";
import type { SearchMode } from "@/lib/types";
import { useT } from "@/lib/i18n";
import type { VaultSchema } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SearchPalette({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; onCreate: () => void }) {
  const { t, tr } = useT();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [selected, setSelected] = useState("");
  const schema = useApi<VaultSchema>(open ? "/api/v1/schema" : null);
  const results = useSearch({ q: open ? q : "", mode, type, status, limit: 8, passages: 1, debounce: mode === "smart" ? 400 : 150 });
  const hits = results.hits;
  const busy = results.loading;
  const terms = queryTerms(q);

  // cmdk keeps the item selected when the list changes: follow the best hit as results arrive.
  useEffect(() => {
    setSelected(hits[0]?.note.id ?? (q.trim() ? "__ask" : ""));
  }, [hits, q]);

  const go = (path: string) => {
    onOpenChange(false);
    setQ("");
    router.push(path);
  };

  const chip = (on: boolean) => cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-primary bg-accent font-medium" : "text-muted-foreground hover:bg-muted");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("search.title")} description={t("search.help")} className="top-[10vh] w-[min(94vw,42rem)] p-0" closeLabel={t("close")}>
        <Command shouldFilter={false} value={selected} onValueChange={setSelected} label={t("search.title")} className="flex flex-col">
          <div className="border-b p-3 pr-10">
            <Command.Input value={q} onValueChange={setQ} placeholder={t("search.placeholder")} className="h-10 w-full bg-transparent px-1 text-base placeholder:text-muted-foreground focus:outline-none" aria-label={t("search.placeholder")} />
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t("search.filters")}>
              {schema.data &&
                Object.keys(schema.data.types)
                  .filter((x) => x !== "issue" && x !== "pull-request")
                  .map((x) => (
                    <button key={x} type="button" aria-pressed={type === x} onClick={() => setType(type === x ? undefined : x)} className={chip(type === x)}>
                      {tr("type", x)}
                    </button>
                  ))}
              {schema.data?.statuses.map((x) => (
                <button key={x} type="button" aria-pressed={status === x} onClick={() => setStatus(status === x ? undefined : x)} className={chip(status === x)}>
                  {tr("status", x)}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <ModePicker value={mode} onChange={setMode} idPrefix="palette-mode" />
            </div>
            {results.understood && mode === "smart" && (
              <div className="mt-3">
                <Understood u={results.understood} />
              </div>
            )}
          </div>
          <Command.List className="max-h-[50vh] overflow-y-auto p-2">
            {q.trim() && !busy && hits.length === 0 && <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">{t("search.none")}</Command.Empty>}
            {busy && <div className="px-3 py-2 text-sm text-muted-foreground" role="status">{t("loading")}</div>}
            {hits.map((h) => (
              <Command.Item key={h.note.id} value={h.note.id} onSelect={() => go(notePath(h.note.id))} className="flex cursor-pointer flex-col gap-1 rounded-lg px-3 py-2 data-[selected=true]:bg-muted">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{h.note.title}</span>
                  <TypeBadge type={h.note.type} />
                  <StatusBadge status={h.note.status} />
                  <span className="text-xs text-muted-foreground">{h.note.id}</span>
                </span>
                <span className="line-clamp-2 text-sm text-muted-foreground">
                  {h.chunk.heading !== h.note.title && <strong className="mr-1 font-medium text-foreground">{h.chunk.heading} ·</strong>}
                  <Marked text={h.chunk.snippet} terms={terms} />
                </span>
              </Command.Item>
            ))}
            {q.trim() && (
              <Command.Group heading={t("search.actions")} className="mt-1 text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1">
                <Command.Item value="__all" onSelect={() => go(`/search/?q=${encodeURIComponent(q.trim())}${mode === "hybrid" ? "" : `&mode=${mode}`}${type ? `&type=${encodeURIComponent(type)}` : ""}${status ? `&status=${encodeURIComponent(status)}` : ""}`)} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground data-[selected=true]:bg-muted">
                  <Search className="size-4" aria-hidden />
                  {t("search.seeAll", { q: q.trim() })}
                </Command.Item>
                <Command.Item value="__ask" onSelect={() => go(`/?ask=${encodeURIComponent(q.trim())}`)} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground data-[selected=true]:bg-muted">
                  <MessageCircleQuestion className="size-4" aria-hidden />
                  {t("search.ask", { q: q.trim() })}
                </Command.Item>
                <Command.Item
                  value="__create"
                  onSelect={() => {
                    onOpenChange(false);
                    onCreate();
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground data-[selected=true]:bg-muted"
                >
                  <FilePlus className="size-4" aria-hidden />
                  {t("search.create")}
                </Command.Item>
              </Command.Group>
            )}
          </Command.List>
          <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> {t("search.navigate")}</span>
            <span className="flex items-center gap-1"><Kbd><CornerDownLeft className="inline size-3" aria-hidden /></Kbd> {t("search.openNote")}</span>
            <span className="flex items-center gap-1"><Kbd>Esc</Kbd> {t("close")}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
