"use client";

import { useState } from "react";
import { Timeline, type TimelineEvent } from "@/components/arc/timeline/timeline";
import { EmptyState, PageAlert, PageSkeleton } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { errorMessage, noteApi, qs } from "@/lib/api";
import { sideBySide } from "@/lib/diff";
import { useT } from "@/lib/i18n";
import type { Commit } from "@/lib/types";
import { cn } from "@/lib/utils";

const timeZone = typeof Intl === "undefined" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The changes one commit made, as a side-by-side table. Loaded when its row opens. */
function CommitDiff({ id, hash }: { id: string; hash: string }) {
  const { t } = useT();
  const diff = useApi<{ patch: string }>(`${noteApi(id)}/history${qs({ diff: hash })}`);
  const rows = diff.data ? sideBySide(diff.data.patch) : [];
  const cell = (c: { n: number; text: string } | null, tone: string) => (
    <>
      <td className="w-10 select-none px-2 text-right text-xs text-muted-foreground">{c?.n ?? ""}</td>
      <td className={cn("whitespace-pre-wrap break-words px-2 font-mono text-xs", tone)}>{c?.text ?? ""}</td>
    </>
  );
  return (
    <div className="min-w-0 pb-3">
      {diff.loading && <PageSkeleton label={t("loading")} lines={2} />}
      {diff.error && <PageAlert title={t("error.title")}>{errorMessage(diff.error)}</PageAlert>}
      {diff.data && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full table-fixed border-collapse" aria-label={t("history.diff")}>
            <caption className="sr-only">{t("history.diff")}</caption>
            <colgroup>
              <col className="w-10" />
              <col />
              <col className="w-10" />
              <col />
            </colgroup>
            <tbody>
              {rows.map((r, i) =>
                r.kind === "hunk" ? (
                  <tr key={i} className="bg-muted">
                    <td colSpan={4} className="px-2 py-1 font-mono text-xs text-muted-foreground">{r.hunk}</td>
                  </tr>
                ) : (
                  <tr key={i} className="align-top">
                    {cell(r.left, r.kind === "del" || r.kind === "change" ? "border-l-4 border-destructive bg-destructive/20" : "")}
                    {cell(r.right, r.kind === "add" || r.kind === "change" ? "border-l-4 border-success bg-success/20" : "")}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function History({ id }: { id: string }) {
  const { t, lang } = useT();
  const log = useApi<{ commits: Commit[] }>(`${noteApi(id)}/history`);
  const [now] = useState(() => Date.now());

  if (log.loading) return <PageSkeleton label={t("loading")} />;
  if (log.error) return <PageAlert title={t("error.title")}>{errorMessage(log.error)}</PageAlert>;
  const commits = log.data?.commits ?? [];
  if (!commits.length) return <EmptyState title={t("history.noneTitle")} description={t("history.noneHelp")} />;

  const events: TimelineEvent[] = commits.map((c) => ({ id: c.hash, at: c.date, actor: c.author, title: c.message, meta: c.hash.slice(0, 7), detail: <CommitDiff id={id} hash={c.hash} /> }));
  const rtf = (style: "narrow" | "long") => new Intl.RelativeTimeFormat(lang, { numeric: "auto", style });
  const relative = (time: number, at: number) => {
    const minutes = -Math.max(0, Math.floor((at - time) / 60_000));
    const [value, unit] = Math.abs(minutes) < 60 ? [minutes, "minute" as const] : [Math.trunc(minutes / 60), "hour" as const];
    return { short: rtf("narrow").format(value, unit), long: rtf("long").format(value, unit) };
  };
  const copy = { today: t("history.today"), yesterday: t("history.yesterday"), update: t("history.update"), updates: t("history.updates"), newUpdate: t("history.newUpdate"), relative };

  return <Timeline events={events} now={now} label={t("history.commits")} timeZone={timeZone} locale={lang} defaultExpanded={[commits[0]?.hash ?? ""]} copy={copy} />;
}
