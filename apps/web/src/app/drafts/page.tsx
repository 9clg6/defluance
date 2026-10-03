"use client";

import { FileDiff, GitMerge, GitPullRequest, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { DiffTable } from "@/components/DiffTable";
import { Badge, Button, Card, Dialog, DialogContent, EmptyState, ErrorBox, PageAlert, PageSkeleton } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { api, ApiError, errorMessage, notePath, qs } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import { relativeTime } from "@/lib/frontmatter";
import { useT } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import type { Draft, DraftDetail, GithubStatus } from "@/lib/types";

export default function DraftsPage() {
  return (
    <Suspense fallback={null}>
      <Drafts />
    </Suspense>
  );
}

function Drafts() {
  const { t, lang } = useT();
  const { me } = useAuth();
  const params = useSearchParams();
  const branch = params.get("branch");
  const drafts = useApi<Draft[]>("/api/v1/drafts");
  const list = drafts.data ?? [];
  const selected = branch && list.some((d) => d.branch === branch) ? branch : null;

  const open = (b: string | null) => {
    const url = new URL(window.location.href);
    if (b) url.searchParams.set("branch", b);
    else url.searchParams.delete("branch");
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("drafts.title")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("drafts.intro")}</p>
      </header>

      {drafts.loading && !drafts.data && <PageSkeleton label={t("loading")} />}
      {drafts.error && <PageAlert title={t("error.title")}>{errorMessage(drafts.error)}</PageAlert>}
      {drafts.data && list.length === 0 && <EmptyState title={t("drafts.emptyTitle")} description={t("drafts.emptyHelp")} />}

      {list.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <section aria-label={t("drafts.list")} className="space-y-3">
            <ul className="space-y-3">
              {list.map((d) => (
                <li key={d.branch}>
                  <Card className={selected === d.branch ? "border-primary" : ""}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{d.files.map((f) => f.id ?? f.path).join(", ")}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("drafts.by", { agent: d.agent })} · {d.commits === 1 ? t("drafts.commit") : t("drafts.commits", { n: d.commits })} · {relativeTime(d.last.date, lang)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge tone={d.mergeable === true ? "success" : d.mergeable === false ? "destructive" : "muted"}>
                        {d.mergeable === true ? t("drafts.clean") : d.mergeable === false ? t("drafts.conflict") : t("drafts.unknown")}
                      </Badge>
                      {d.files.some((f) => f.private) && <Badge tone="primary">{t("drafts.private")}</Badge>}
                    </div>
                    <Button className="mt-3" size="sm" variant={selected === d.branch ? "default" : "outline"} onClick={() => open(d.branch)} aria-label={`${t("drafts.review")}: ${d.files.map((f) => f.id ?? f.path).join(", ")}`}>
                      <FileDiff className="size-4" aria-hidden />
                      {t("drafts.review")}
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          <section aria-live="polite" className="min-w-0">
            {selected ? <Review key={selected} branch={selected} writable={can(me, "write")} onDone={() => { open(null); void drafts.reload(); }} /> : <p className="text-sm text-muted-foreground">{t("drafts.pick")}</p>}
          </section>
        </div>
      )}
    </div>
  );
}

function Review({ branch, writable, onDone }: { branch: string; writable: boolean; onDone: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const detail = useApi<DraftDetail>(`/api/v1/drafts/diff${qs({ branch })}`);
  const gh = useApi<GithubStatus & { vaultRepo?: string | null }>("/api/v1/github/status");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; help?: string }>();
  const [pr, setPr] = useState<string>();
  const [confirm, setConfirm] = useState(false);

  const run = async (what: "merge" | "discard" | "pull-request") => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.post<{ url?: string }>(`/api/v1/drafts/${what}`, { branch });
      if (what === "pull-request") {
        setPr(r.url);
        toast("ok", t("drafts.prOpened"));
      } else {
        toast("ok", t(what === "merge" ? "drafts.merged" : "drafts.discarded"));
        onDone();
      }
    } catch (e) {
      const help = e instanceof ApiError ? (e.status === 409 && e.extra["reason"] === "conflict" ? t("drafts.conflictHelp") : e.status === 423 ? t("drafts.unlockHelp") : undefined) : undefined;
      setError({ text: errorMessage(e), ...(help ? { help } : {}) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  if (detail.loading && !detail.data) return <PageSkeleton label={t("loading")} />;
  if (detail.error) return <PageAlert title={t("error.title")}>{errorMessage(detail.error)}</PageAlert>;
  const d = detail.data;
  if (!d) return null;
  const canPr = !!gh.data?.configured && !!gh.data.vaultRepo;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-xl font-semibold">{t("drafts.changes")}</h2>
        {writable && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button onClick={() => void run("merge")} disabled={busy || d.mergeable === false}>
              <GitMerge className="size-4" aria-hidden />
              {t("drafts.merge")}
            </Button>
            {canPr && (
              <Button variant="outline" onClick={() => void run("pull-request")} disabled={busy}>
                <GitPullRequest className="size-4" aria-hidden />
                {t("drafts.pr")}
              </Button>
            )}
            <Button variant="outline" onClick={() => setConfirm(true)} disabled={busy}>
              <Trash2 className="size-4" aria-hidden />
              {t("drafts.discard")}
            </Button>
          </div>
        )}
      </div>
      {error && (
        <ErrorBox>
          {error.text}
          {error.help && <span className="mt-1 block text-foreground">{error.help}</span>}
        </ErrorBox>
      )}
      {pr && (
        <p className="text-sm">
          {t("drafts.prOpened")}:{" "}
          <a href={pr} className="text-primary underline" target="_blank" rel="noreferrer">{t("drafts.prLink")}</a>
        </p>
      )}
      {d.files.map((f) => (
        <article key={f.path} className="space-y-2">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <Badge tone={f.status === "A" ? "success" : f.status === "D" ? "destructive" : "muted"}>{f.status === "A" ? t("drafts.added") : f.status === "D" ? t("drafts.deleted") : t("drafts.modified")}</Badge>
            {f.id ? <Link href={notePath(f.id)} className="text-primary underline">{f.id}</Link> : <code>{f.path}</code>}
          </h3>
          {f.private ? <p className="text-sm text-muted-foreground">{t("drafts.private")}</p> : <DiffTable patch={f.patch} label={`${t("drafts.changes")}: ${f.path}`} />}
        </article>
      ))}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent title={t("drafts.discardTitle")} description={t("drafts.discardBody")} closeLabel={t("close")}>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={() => void run("discard")}>{t("drafts.discard")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
