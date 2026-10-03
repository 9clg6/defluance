"use client";

import { useEffect, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { errorMessage, noteApi, qs } from "@/lib/api";
import { sideBySide } from "@/lib/diff";
import { relativeTime } from "@/lib/frontmatter";
import { useT } from "@/lib/i18n";
import type { Commit } from "@/lib/types";
import { cn } from "@/lib/utils";

export function History({ id }: { id: string }) {
  const { t, lang } = useT();
  const log = useApi<{ commits: Commit[] }>(`${noteApi(id)}/history`);
  const [selected, setSelected] = useState<string>();
  const diff = useApi<{ patch: string }>(selected ? `${noteApi(id)}/history${qs({ diff: selected })}` : null);

  useEffect(() => {
    if (!selected && log.data?.commits[0]) setSelected(log.data.commits[0].hash);
  }, [log.data, selected]);

  if (log.loading) return <Spinner label={t("loading")} />;
  if (log.error) return <ErrorBox>{errorMessage(log.error)}</ErrorBox>;
  const commits = log.data?.commits ?? [];
  if (!commits.length) return <p className="text-sm text-muted-foreground">{t("history.none")}</p>;

  const rows = diff.data ? sideBySide(diff.data.patch) : [];
  const cell = (c: { n: number; text: string } | null, tone: string) => (
    <>
      <td className="w-10 select-none px-2 text-right text-xs text-muted-foreground">{c?.n ?? ""}</td>
      <td className={cn("whitespace-pre-wrap break-words px-2 font-mono text-xs", tone)}>{c?.text ?? ""}</td>
    </>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <ol className="max-h-[32rem] space-y-1 overflow-y-auto" aria-label={t("history.commits")}>
        {commits.map((c) => (
          <li key={c.hash}>
            <button type="button" aria-pressed={selected === c.hash} onClick={() => setSelected(c.hash)} className={cn("w-full rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted", selected === c.hash && "border-primary bg-accent")}>
              <span className="block font-medium">{c.message}</span>
              <span className="block text-xs text-muted-foreground">
                {c.author} · {relativeTime(c.date, lang)} · <code>{c.hash.slice(0, 7)}</code>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="min-w-0">
        {diff.loading && <Spinner label={t("loading")} />}
        {diff.error && <ErrorBox>{errorMessage(diff.error)}</ErrorBox>}
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
                      {cell(r.left, r.kind === "del" || r.kind === "change" ? "bg-destructive/10" : "")}
                      {cell(r.right, r.kind === "add" || r.kind === "change" ? "bg-success/10" : "")}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
