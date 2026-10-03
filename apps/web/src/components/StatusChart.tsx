"use client";

import { Card } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { NoteStats } from "@/lib/types";

/** Solid, saturated, no pastel: each segment is told apart by more than colour, since the counts are written next to the bar. */
export const STATUS_COLORS: Record<string, string> = {
  draft: "#737373",
  review: "#ca8a04",
  approved: "#2563eb",
  implemented: "#0d9488",
  deprecated: "#b91c1c",
  none: "#a3a3a3",
};
const ORDER = ["draft", "review", "approved", "implemented", "deprecated", "none"];

/**
 * Where each kind of note stands, as stacked bars. The table carries the facts (type, then every count in words);
 * the bar is a drawing of the same numbers and is hidden from assistive technology.
 */
export function StatusChart({ stats }: { stats: NoteStats }) {
  const { t, tr, lang } = useT();
  if (!stats.total) return null;
  const label = (s: string) => (s === "none" ? t("stats.none") : tr("status", s));
  // Bars are scaled to the biggest type, so their lengths compare volumes and their colours show the mix.
  const biggest = Math.max(...stats.groups.map((g) => g.total));
  const used = ORDER.filter((s) => stats.groups.some((g) => g.statuses[s]));

  return (
    <Card className="space-y-4">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground" aria-label={t("stats.legend")}>
        {used.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm" style={{ background: STATUS_COLORS[s] }} aria-hidden />
            {label(s)}
          </li>
        ))}
      </ul>
      <table className="w-full text-sm">
        <caption className="sr-only">{t("stats.caption")}</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">{t("note.type")}</th>
            <th scope="col">{t("stats.chart")}</th>
            <th scope="col">{t("stats.counts")}</th>
          </tr>
        </thead>
        <tbody>
          {stats.groups.map((g, row) => (
            <tr key={g.type} className="align-middle">
              <th scope="row" className="w-40 py-1.5 pr-3 text-left font-medium">{g.type === "untyped" ? t("stats.none") : tr("type", g.type)}</th>
              <td className="w-1/2 py-1.5 pr-3">
                <div className="flex h-3 gap-px overflow-hidden rounded-full" style={{ width: `${(100 * g.total) / biggest}%` }} aria-hidden>
                  {ORDER.filter((s) => g.statuses[s]).map((s) => (
                    <span
                      key={s}
                      className="dfl-bar block h-full"
                      style={{ width: `${(100 * (g.statuses[s] ?? 0)) / g.total}%`, background: STATUS_COLORS[s], animationDelay: `${row * 60}ms` }}
                    />
                  ))}
                </div>
              </td>
              <td className="py-1.5 text-muted-foreground">
                {ORDER.filter((s) => g.statuses[s])
                  .map((s) => `${label(s)}${lang === "fr" ? " : " : ": "}${g.statuses[s]}`)
                  .join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
