"use client";

import { Search as SearchIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ModePicker } from "@/components/ModePicker";
import { ResultCard } from "@/components/ResultCard";
import { Understood } from "@/components/Understood";
import { Button, ErrorBox, Input, Select, Spinner } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { useSearch } from "@/hooks/use-search";
import { useAuth } from "@/lib/auth";
import { qs } from "@/lib/api";
import { queryTerms } from "@/lib/highlight";
import { useT } from "@/lib/i18n";
import type { SearchMode, VaultSchema } from "@/lib/types";

const MODES: SearchMode[] = ["hybrid", "keyword", "meaning", "smart"];

export default function SearchPage() {
  const { t, tr } = useT();
  const { me } = useAuth();
  const schema = useApi<VaultSchema>("/api/v1/schema");
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");

  // The address is the state: a search can be shared and the back button works.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const m = p.get("mode");
    setInput(p.get("q") ?? "");
    setQ(p.get("q") ?? "");
    setMode(MODES.includes(m as SearchMode) ? (m as SearchMode) : "hybrid");
    setType(p.get("type") ?? "");
    setStatus(p.get("status") ?? "");
  }, []);

  const apply = (next: { q?: string; mode?: SearchMode; type?: string; status?: string }) => {
    const v = { q, mode, type, status, ...next };
    setQ(v.q);
    setMode(v.mode);
    setType(v.type);
    setStatus(v.status);
    window.history.replaceState(null, "", `/search/${qs({ q: v.q, mode: v.mode === "hybrid" ? undefined : v.mode, type: v.type, status: v.status })}`);
  };

  const results = useSearch({ q, mode, type: type || undefined, status: status || undefined, limit: 20, passages: 3 });
  const terms = useMemo(() => queryTerms(results.forQuery || q), [results.forQuery, q]);
  const cap = me?.capabilities;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("search.page.title")}</h1>
      <form
        role="search"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q: input });
        }}
      >
        <div className="flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} autoFocus className="h-11 text-base" />
          <Button type="submit" className="h-11">
            <SearchIcon className="size-4" aria-hidden />
            {t("search.page.submit")}
          </Button>
        </div>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <ModePicker value={mode} onChange={(m) => apply({ mode: m })} idPrefix="page-mode" />
          <div>
            <label htmlFor="s-type" className="mb-1 block text-xs text-muted-foreground">{t("note.type")}</label>
            <Select id="s-type" value={type} onChange={(e) => apply({ type: e.target.value })}>
              <option value="">{t("graph.all")}</option>
              {Object.keys(schema.data?.types ?? {}).filter((x) => x !== "issue" && x !== "pull-request").map((x) => <option key={x} value={x}>{tr("type", x)}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor="s-status" className="mb-1 block text-xs text-muted-foreground">{t("note.status")}</label>
            <Select id="s-status" value={status} onChange={(e) => apply({ status: e.target.value })}>
              <option value="">{t("graph.all")}</option>
              {schema.data?.statuses.map((x) => <option key={x} value={x}>{tr("status", x)}</option>)}
            </Select>
          </div>
        </div>
      </form>

      {results.understood && <Understood u={results.understood} />}
      {results.error && <ErrorBox>{results.error}</ErrorBox>}
      {results.loading && <Spinner label={t("loading")} />}
      {!q.trim() && <p className="text-muted-foreground">{t("search.page.empty")}</p>}

      {q.trim() && !results.loading && !results.error && (
        <section aria-label={t("search.page.title")} aria-live="polite" className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("search.page.count", { n: results.hits.length })}</p>
          {results.hits.length === 0 && <p>{t("search.page.none")}</p>}
          {results.hits.map((h) => (
            <ResultCard key={h.note.id} hit={h} terms={terms} />
          ))}
          <div className="flex flex-wrap gap-4 pt-1 text-sm">
            <Link href={`/?ask=${encodeURIComponent(q)}`} className="text-primary underline underline-offset-2">{t("search.page.askThis")}</Link>
            {cap?.deep && <Link href={`/?ask=${encodeURIComponent(q)}&deep=1`} className="text-primary underline underline-offset-2">{t("search.page.deep")}</Link>}
          </div>
        </section>
      )}
    </div>
  );
}
