"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, ErrorBox, Input, Spinner } from "@/components/ui";
import { api, errorMessage, notePath, qs } from "@/lib/api";
import { relativeTime } from "@/lib/frontmatter";
import { useT } from "@/lib/i18n";
import type { AuditEntry } from "@/lib/types";

const PAGE = 50;

export default function AuditPage() {
  const { t, lang } = useT();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [filters, setFilters] = useState({ actor: "", action: "", target: "" });
  const [applied, setApplied] = useState(filters);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (reset: boolean, before?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const page = await api.get<AuditEntry[]>(`/api/v1/audit${qs({ ...applied, before, limit: PAGE })}`);
        setRows((r) => (reset ? page : [...r, ...page]));
        setMore(page.length === PAGE);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [applied],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const field = (key: keyof typeof filters, label: string) => (
    <div>
      <label htmlFor={`a-${key}`} className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <Input id={`a-${key}`} value={filters[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} className="w-44" />
    </div>
  );

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("audit.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("audit.help")}</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setApplied(filters); }}>
        {field("actor", t("audit.actor"))}
        {field("action", t("audit.action"))}
        {field("target", t("audit.target"))}
        <Button type="submit" variant="outline">{t("audit.filter")}</Button>
      </form>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("audit.title")}</caption>
          <thead className="bg-muted text-left">
            <tr>
              {["audit.when", "audit.actor", "audit.action", "audit.target", "audit.commit"].map((k) => <th key={k} scope="col" className="px-3 py-2 font-medium">{t(k as never)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t align-top">
                <td className="whitespace-nowrap px-3 py-2" title={e.at}>{relativeTime(e.at, lang)}</td>
                <td className="px-3 py-2">{e.actor_name} <span className="text-xs text-muted-foreground">({e.actor_type})</span></td>
                <td className="px-3 py-2"><code>{e.action}</code></td>
                <td className="px-3 py-2">{e.target ? <Link href={notePath(e.target)} className="text-primary underline underline-offset-2">{e.target}</Link> : "—"}</td>
                <td className="px-3 py-2">{e.commit_sha ? <code className="text-xs">{e.commit_sha.slice(0, 7)}</code> : "—"}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">{t("audit.none")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {loading && <Spinner label={t("loading")} />}
      {more && !loading && <Button variant="outline" onClick={() => void load(false, rows.at(-1)?.at)}>{t("audit.more")}</Button>}
    </div>
  );
}
