"use client";

import { useState } from "react";
import { DiffTable } from "@/components/DiffTable";
import { Timeline, type TimelineEvent } from "@/components/arc/timeline/timeline";
import { EmptyState, PageAlert, PageSkeleton } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { errorMessage, noteApi, qs } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { Commit } from "@/lib/types";

const timeZone = typeof Intl === "undefined" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The changes one commit made, as a side-by-side table. Loaded when its row opens. */
function CommitDiff({ id, hash }: { id: string; hash: string }) {
  const { t } = useT();
  const diff = useApi<{ patch: string }>(`${noteApi(id)}/history${qs({ diff: hash })}`);
  return (
    <div className="min-w-0 pb-3">
      {diff.loading && <PageSkeleton label={t("loading")} lines={2} />}
      {diff.error && <PageAlert title={t("error.title")}>{errorMessage(diff.error)}</PageAlert>}
      {diff.data && <DiffTable patch={diff.data.patch} label={t("history.diff")} />}
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
