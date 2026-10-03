"use client";

import { CircleDot, Pencil, Save } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AskPanel } from "@/components/AskPanel";
import { StatusBadge, TypeBadge } from "@/components/badges";
import { CreateNote } from "@/components/CreateNote";
import { Editor } from "@/components/Editor";
import { GraphView } from "@/components/GraphView";
import { History } from "@/components/History";
import { IssueDialog } from "@/components/IssueDialog";
import { LinksPanel } from "@/components/LinksPanel";
import { Markdown } from "@/components/Markdown";
import { Badge, Button, Card, ErrorBox, Select, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { api, ApiError, errorMessage, idFromPath, noteApi, notePath, qs } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import { relativeTime, splitFrontmatter, stripTitle } from "@/lib/frontmatter";
import { useT } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import type { AuditEntry, NoteDetail, NoteLinks, Subgraph, VaultSchema, WriteResult } from "@/lib/types";

type TabId = "read" | "edit" | "history" | "graph" | "ask" | "audit";
const TABS: TabId[] = ["read", "edit", "history", "graph", "ask", "audit"];

function useTab(): [TabId, (t: TabId) => void] {
  const raw = useSearchParams().get("tab");
  const tab: TabId = TABS.includes(raw as TabId) ? (raw as TabId) : "read";
  const set = useCallback((t: TabId) => {
    const url = new URL(window.location.href);
    if (t === "read") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  }, []);
  return [tab, set];
}

export function NotePage() {
  const pathname = usePathname() ?? "/n/";
  const id = idFromPath(pathname);
  if (!id) return <EmptyNote />;
  return (
    <Suspense fallback={null}>
      <Loaded key={id} id={id} />
    </Suspense>
  );
}

function EmptyNote() {
  const { t } = useT();
  return (
    <p className="text-muted-foreground">
      {t("note.choose")} <Link href="/" className="text-primary underline">{t("nav.home")}</Link>
    </p>
  );
}

function Loaded({ id }: { id: string }) {
  const { t, lang } = useT();
  const { me } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useTab();
  const note = useApi<NoteDetail>(noteApi(id));
  const links = useApi<NoteLinks>(`${noteApi(id)}/links`);
  const schema = useApi<VaultSchema>("/api/v1/schema");
  const [graphDepth, setGraphDepth] = useState(1);
  const graph = useApi<Subgraph>(tab === "graph" ? `/api/v1/graph/neighbors${qs({ id, depth: graphDepth })}` : null);
  const audit = useApi<AuditEntry[]>(me ? `/api/v1/audit${qs({ target: id, limit: 50 })}` : null);

  const [draft, setDraft] = useState<string>();
  const [editorKey, setEditorKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [conflict, setConflict] = useState<string>();
  const [issueOpen, setIssueOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const n = note.data;
  const dirty = draft !== undefined && n !== undefined && draft !== n.raw;
  const writable = can(me, "write", n?.space);
  const flatLinks = useMemo(() => Object.values(links.data?.outgoing ?? {}).flat(), [links.data]);

  useEffect(() => {
    if (!dirty) return;
    const on = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", on);
    return () => window.removeEventListener("beforeunload", on);
  }, [dirty]);

  useEffect(() => {
    if (tab === "edit" && n && draft === undefined) setDraft(n.raw);
  }, [tab, n, draft]);

  const reload = async () => {
    await Promise.all([note.reload(), links.reload()]);
  };

  const save = async (overrideBase?: string) => {
    if (!n || draft === undefined) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const r = await api.put<WriteResult>(noteApi(id), { content: draft, base_commit: overrideBase ?? n.commit ?? undefined });
      toast("ok", t("note.saved", { commit: r.commit.slice(0, 7) }));
      setConflict(undefined);
      setDraft(undefined);
      await reload();
      setTab("read");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(String(e.extra["current"] ?? ""));
      else setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status: string) => {
    try {
      await api.patch<WriteResult>(`${noteApi(id)}/status`, { status });
      toast("ok", t("note.statusChanged", { status }));
      await reload();
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };

  if (note.loading && !n) return <Spinner label={t("loading")} />;
  if (note.error) {
    if (note.error instanceof ApiError && note.error.status === 404) {
      return (
        <div className="space-y-4">
          <h1 className="font-heading text-2xl font-semibold">{t("note.notFound")}</h1>
          <p className="text-muted-foreground">
            <code>{id}</code>
          </p>
          {can(me, "write") && (
            <>
              <Button onClick={() => setCreateOpen(true)}>{t("note.createThis")}</Button>
              <CreateNote open={createOpen} onOpenChange={setCreateOpen} initialTitle={id.split("/").at(-1) ?? id} />
            </>
          )}
        </div>
      );
    }
    return <ErrorBox>{errorMessage(note.error)}</ErrorBox>;
  }
  if (!n) return null;

  const tabsToShow = TABS.filter((x) => (x === "edit" ? writable : x === "audit" ? !!audit.data : true));
  const preview = draft !== undefined ? splitFrontmatter(draft).body : n.body;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <article className="min-w-0">
        <header className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={n.type} />
            <StatusBadge status={n.status} />
            <Badge tone="muted">{n.space}</Badge>
            {n.tags.map((tag) => (
              <Badge key={tag} tone="muted">#{tag}</Badge>
            ))}
          </div>
          <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight">{n.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {n.id} · {n.owner ?? "—"} · {t("note.updated", { when: relativeTime(n.updated_at, lang) })}
            {n.commit && <> · <code>{n.commit.slice(0, 7)}</code></>}
          </p>
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
          <TabsList aria-label={t("note.sections")}>
            {tabsToShow.map((x) => (
              <TabsTrigger key={x} value={x}>
                {t(`tab.${x}`)}
                {x === "edit" && dirty && <span className="ml-1 text-warning" aria-label={t("note.unsaved")}>●</span>}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="read" className="pt-5">
            <Markdown source={stripTitle(n.body, n.title)} links={flatLinks} />
          </TabsContent>

          <TabsContent value="edit" className="pt-5">
            {writable && draft !== undefined && (
              <div className="space-y-3">
                {conflict !== undefined && (
                  <div role="alert" className="space-y-2 rounded-lg border-2 border-warning p-3 text-sm">
                    <p className="font-medium">{t("conflict.title")}</p>
                    <p>{t("conflict.body", { commit: conflict.slice(0, 7) })}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setConflict(undefined); setDraft(undefined); setEditorKey((k) => k + 1); void reload(); }}>
                        {t("conflict.reload")}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => void save(conflict)}>
                        {t("conflict.overwrite")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConflict(undefined)}>
                        {t("conflict.keep")}
                      </Button>
                    </div>
                  </div>
                )}
                {saveError && <ErrorBox>{saveError}</ErrorBox>}
                <div className="flex items-center gap-2">
                  <Button onClick={() => void save()} disabled={saving || !dirty}>
                    <Save className="size-4" aria-hidden />
                    {t("note.save")}
                  </Button>
                  <Button variant="outline" onClick={() => { setDraft(undefined); setEditorKey((k) => k + 1); setTab("read"); }}>
                    {t("cancel")}
                  </Button>
                  <span className="text-xs text-muted-foreground">{t("note.saveHint")}</span>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <Editor key={editorKey} value={draft} onChange={setDraft} onSave={() => void save()} linkTypes={schema.data?.linkTypes ?? []} label={t("note.editor")} />
                  <div className="min-w-0 rounded-xl border p-4">
                    <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("note.preview")}</h2>
                    <Markdown source={preview} links={flatLinks} />
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="pt-5">
            <History id={id} />
          </TabsContent>

          <TabsContent value="graph" className="space-y-3 pt-5">
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="depth">{t("graph.depth")}</label>
              <Select id="depth" value={graphDepth} onChange={(e) => setGraphDepth(Number(e.target.value))}>
                {[1, 2, 3].map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </div>
            {graph.loading && <Spinner label={t("loading")} />}
            {graph.error && <ErrorBox>{errorMessage(graph.error)}</ErrorBox>}
            {graph.data && <GraphView graph={graph.data} focusId={id} onOpen={(to) => router.push(notePath(to))} height={420} />}
          </TabsContent>

          <TabsContent value="ask" className="pt-5">
            <AskPanel scopeNote={id} />
          </TabsContent>

          <TabsContent value="audit" className="pt-5">
            <ul className="space-y-2 text-sm">
              {audit.data?.map((e) => (
                <li key={e.id} className="rounded-lg border px-3 py-2">
                  <span className="font-medium">{e.actor_name}</span> · {e.action} · <span className="text-muted-foreground">{relativeTime(e.at, lang)}</span>
                  {e.commit_sha && <code className="ml-2 text-xs text-muted-foreground">{e.commit_sha.slice(0, 7)}</code>}
                </li>
              ))}
            </ul>
          </TabsContent>
        </Tabs>
      </article>

      <aside className="space-y-4" aria-label={t("note.sidebar")}>
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">{t("note.actions")}</h2>
          {writable && schema.data && (
            <div>
              <label htmlFor="status" className="mb-1 block text-xs text-muted-foreground">{t("note.status")}</label>
              <Select id="status" className="w-full" value={n.status ?? ""} onChange={(e) => void changeStatus(e.target.value)}>
                {!n.status && <option value="" />}
                {schema.data.statuses.map((s) => <option key={s} value={s}>{t(`status.${s}` as never)}</option>)}
              </Select>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {writable && tab !== "edit" && (
              <Button variant="outline" size="sm" onClick={() => setTab("edit")}>
                <Pencil className="size-4" aria-hidden />
                {t("tab.edit")}
              </Button>
            )}
            {can(me, "issues", n.space) && (
              <Button variant="outline" size="sm" onClick={() => setIssueOpen(true)}>
                <CircleDot className="size-4" aria-hidden />
                {t("issue.open")}
              </Button>
            )}
          </div>
        </Card>
        <Card>
          {links.loading && !links.data ? <Spinner label={t("loading")} /> : links.data ? <LinksPanel links={links.data} /> : links.error ? <ErrorBox>{errorMessage(links.error)}</ErrorBox> : null}
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-semibold">{t("note.details")}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {Object.entries(n.frontmatter)
              .filter(([k]) => k !== "links")
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-words">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                </div>
              ))}
          </dl>
        </Card>
      </aside>

      <IssueDialog id={id} title={n.title} space={n.space} open={issueOpen} onOpenChange={setIssueOpen} onCreated={() => void links.reload()} />
    </div>
  );
}
