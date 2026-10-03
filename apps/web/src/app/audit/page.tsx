"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import DateRangePicker, { type DateRange, type DateRangePreset } from "@/components/arc/date-range-picker/date-range-picker";
import { Button, EmptyState, Input, PageAlert, PageSkeleton } from "@/components/ui";
import { api, errorMessage, notePath, qs } from "@/lib/api";
import { relativeTime } from "@/lib/frontmatter";
import { useT } from "@/lib/i18n";
import type { AuditEntry } from "@/lib/types";

const PAGE = 50;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export default function AuditPage() {
  const { t, lang } = useT();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [filters, setFilters] = useState({ actor: "", action: "", target: "" });
  const [applied, setApplied] = useState(filters);
  const [range, setRange] = useState<DateRange | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (reset: boolean, before?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const page = await api.get<AuditEntry[]>(`/api/v1/audit${qs({ ...applied, from: range?.start.toISOString(), to: range && addDays(range.end, 1).toISOString(), before, limit: PAGE })}`);
        setRows((r) => (reset ? page : [...r, ...page]));
        setMore(page.length === PAGE);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [applied, range],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const presets: DateRangePreset[] = [
    { label: t("audit.dates.today"), range: (d) => ({ start: d, end: d }) },
    { label: t("audit.dates.last7"), range: (d) => ({ start: addDays(d, -6), end: d }) },
    { label: t("audit.dates.last30"), range: (d) => ({ start: addDays(d, -29), end: d }) },
    { label: t("audit.dates.thisMonth"), range: (d) => ({ start: new Date(d.getFullYear(), d.getMonth(), 1), end: d }) },
  ];
  const copy = { previous: t("audit.dates.previous"), next: t("audit.dates.next"), presets: t("audit.dates.presets"), cancel: t("audit.dates.cancel"), apply: t("audit.dates.apply"), none: t("audit.dates.none"), day: t("audit.dates.day"), days: t("audit.dates.days"), start: t("audit.dates.start"), chooseEnd: t("audit.dates.chooseEnd"), pickEnd: t("audit.dates.pickEnd") };

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
        <div>
          <span className="mb-1 block text-xs text-muted-foreground">{t("audit.dates")}</span>
          <div className="flex items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} label={t("audit.dates")} placeholder={t("audit.dates.any")} presets={presets} locale={lang} weekStartsOn={lang === "fr" ? 1 : 0} months={1} copy={copy} />
            {range && <Button type="button" variant="ghost" size="sm" onClick={() => setRange(null)}>{t("audit.dates.clear")}</Button>}
          </div>
        </div>
        <Button type="submit" variant="outline">{t("audit.filter")}</Button>
      </form>
      {error && <PageAlert title={t("error.title")}>{error}</PageAlert>}
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
              <tr><td colSpan={5}><EmptyState title={t("audit.none")} description={t("audit.noneHelp")} /></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {loading && <PageSkeleton label={t("loading")} lines={2} />}
      {more && !loading && <Button variant="outline" onClick={() => void load(false, rows.at(-1)?.at)}>{t("audit.more")}</Button>}
    </div>
  );
}
