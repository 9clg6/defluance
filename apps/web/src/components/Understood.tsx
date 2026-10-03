"use client";

import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { Understood as U } from "@/lib/types";

/** What the model did with the question: the searches it ran, the filters it guessed, whether it reordered. */
export function Understood({ u }: { u: U }) {
  const { t, tr } = useT();
  const filters = Object.entries(u.filters);
  return (
    <section aria-label={t("search.understood")} className="rounded-xl border bg-accent/40 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <Sparkles className="size-4" aria-hidden />
        {t("search.understood")}
      </p>
      {u.fallback ? (
        <p className="mt-1 text-muted-foreground">{t("search.understood.fallback", { reason: u.fallback })}</p>
      ) : (
        <dl className="mt-2 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <dt className="text-muted-foreground">{t("search.understood.queries")}</dt>
            {u.queries.map((q) => (
              <dd key={q}>
                <Badge tone="muted">{q}</Badge>
              </dd>
            ))}
          </div>
          {filters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <dt className="text-muted-foreground">{t("search.understood.filters")}</dt>
              {filters.map(([k, v]) => (
                <dd key={k}>
                  <Badge tone="primary">{k === "type" || k === "status" ? tr(k, v as string) : `${k}: ${v}`}</Badge>
                </dd>
              ))}
            </div>
          )}
        </dl>
      )}
      {u.filtersDropped && <p className="mt-1 text-muted-foreground">{t("search.understood.dropped")}</p>}
      {u.reranked && <p className="mt-1 text-muted-foreground">{t("search.understood.reranked")}</p>}
    </section>
  );
}
