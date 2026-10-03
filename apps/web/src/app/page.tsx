"use client";

import { FilePlus, Network, Terminal } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AskPanel } from "@/components/AskPanel";
import { StatusBadge, TypeBadge } from "@/components/badges";
import { CreateNote } from "@/components/CreateNote";
import { StatusChart } from "@/components/StatusChart";
import { DraggableMarquee } from "@/components/block/draggable-marquee";
import { FlipText } from "@/components/block/flip-text";
import { Button, Card, Spinner } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { notePath, qs } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import { relativeTime } from "@/lib/frontmatter";
import { useT } from "@/lib/i18n";
import type { IndexStatus, NoteStats, NoteSummary } from "@/lib/types";

interface Page {
  items: NoteSummary[];
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const { t, lang } = useT();
  const { me } = useAuth();
  const status = useApi<IndexStatus>("/api/v1/index/status");
  const recent = useApi<Page>(`/api/v1/notes${qs({ sort: "updated", limit: 12 })}`);
  const review = useApi<Page>(`/api/v1/notes${qs({ status: "review", limit: 6 })}`);
  const lint = useApi<{ orphans: string[]; broken: unknown[] }>("/api/v1/graph/lint");
  const stats = useApi<NoteStats>("/api/v1/stats");
  const params = useSearchParams();
  const ask = params.get("ask") ?? undefined;
  const deep = params.get("deep") === "1";
  const [createOpen, setCreateOpen] = useState(false);

  const notes = recent.data?.items ?? [];
  const empty = !recent.loading && !!status.data && status.data.notes === 0;

  return (
    <div className="space-y-10">
      <section className="space-y-3 pt-4">
        <h1 aria-label="Defluance" className="font-heading text-5xl font-semibold tracking-tight sm:text-6xl">
          <FlipText>Defluance</FlipText>
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">{t("home.tagline")}</p>
      </section>

      {empty ? (
        <Card className="max-w-2xl space-y-3">
          <h2 className="font-heading text-lg font-semibold">{t("home.emptyTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("home.emptyBody")}</p>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-sm"><code>{"defluance init\ndefluance new functional-spec \"My first spec\""}</code></pre>
          {can(me, "write") && (
            <>
              <Button onClick={() => setCreateOpen(true)}>
                <FilePlus className="size-4" aria-hidden />
                {t("note.new")}
              </Button>
              <CreateNote open={createOpen} onOpenChange={setCreateOpen} />
            </>
          )}
        </Card>
      ) : (
        <>
          <div className="max-w-3xl">
            <AskPanel key={`${ask ?? "free"}-${deep}`} initialQuestion={ask} initialDeep={deep} />
          </div>

          <section aria-labelledby="stats" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <h2 id="stats" className="sr-only">{t("home.stats")}</h2>
            {[
              [t("home.notes"), status.data?.notes],
              [t("home.links"), status.data?.edges],
              [t("home.passages"), status.data?.chunks],
              [t("home.indexed"), status.data?.indexed_at ? relativeTime(status.data.indexed_at, lang) : "—"],
            ].map(([label, value]) => (
              <Card key={label as string}>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="font-heading text-2xl font-semibold">{value ?? "…"}</p>
              </Card>
            ))}
          </section>

          {stats.data && stats.data.total > 0 && (
            <section aria-labelledby="progress" className="space-y-3">
              <h2 id="progress" className="font-heading text-xl font-semibold">{t("home.progress")}</h2>
              <StatusChart stats={stats.data} />
            </section>
          )}

          <section aria-labelledby="recent" className="space-y-3">
            <h2 id="recent" className="font-heading text-xl font-semibold">{t("home.recent")}</h2>
            {recent.loading && <Spinner label={t("loading")} />}
            {notes.length >= 4 ? (
              <DraggableMarquee
                items={notes.map((n) => ({ id: n.id, src: n.id }))}
                label={t("home.marqueeLabel")}
                speed={0.4}
                repeatCount={3}
                pauseOnHover
                itemClassName=""
                className="py-1"
                renderItem={(item: { src: string }, _index: number, duplicate: boolean) => {
                  const n = notes.find((x) => x.id === item.src) as NoteSummary; // duplicates are hidden from assistive tech: keep them out of the tab order
                  return (
                    <Link href={notePath(n.id)} tabIndex={duplicate ? -1 : undefined} draggable={false} className="block w-64 rounded-xl border bg-card p-4 hover:border-primary">
                      <span className="flex flex-wrap gap-1.5">
                        <TypeBadge type={n.type} />
                        <StatusBadge status={n.status} />
                      </span>
                      <span className="mt-2 block font-medium">{n.title}</span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">{n.id} · {relativeTime(n.updated_at, lang)}</span>
                    </Link>
                  );
                }}
              />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {notes.map((n) => (
                  <li key={n.id}>
                    <Link href={notePath(n.id)} className="block rounded-xl border bg-card p-4 hover:border-primary">
                      <span className="flex flex-wrap gap-1.5">
                        <TypeBadge type={n.type} />
                        <StatusBadge status={n.status} />
                      </span>
                      <span className="mt-2 block font-medium">{n.title}</span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">{n.id}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="review" className="space-y-3">
              <h2 id="review" className="font-heading text-xl font-semibold">{t("home.review")}</h2>
              {review.data && review.data.items.length === 0 && <p className="text-sm text-muted-foreground">{t("home.reviewNone")}</p>}
              <ul className="space-y-2">
                {review.data?.items.map((n) => (
                  <li key={n.id}>
                    <Link href={notePath(n.id)} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 hover:border-primary">
                      <span className="font-medium">{n.title}</span>
                      <TypeBadge type={n.type} />
                      <span className="ml-auto text-xs text-muted-foreground">{n.owner}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="health" className="space-y-3">
              <h2 id="health" className="font-heading text-xl font-semibold">{t("home.health")}</h2>
              <Card className="space-y-2 text-sm">
                <p>{t("home.orphans", { n: lint.data?.orphans.length ?? 0 })}</p>
                <p>{t("home.broken", { n: lint.data?.broken.length ?? 0 })}</p>
                <Link href="/graph/?lint=1" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
                  <Network className="size-4" aria-hidden />
                  {t("home.openGraph")}
                </Link>
              </Card>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Terminal className="size-3.5" aria-hidden />
                {t("home.mcpHint")}
              </p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
