"use client";

import { CircleDot, FolderInput, Link2, Lock, Save, SlidersHorizontal, Sparkles, Trash2, Unlock, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ComponentPropsWithoutRef, forwardRef, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarGroup } from "@/components/arc/avatar-group/avatar-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/arc/popover/popover";
import { Breadcrumb } from "@/components/arc/breadcrumb/breadcrumb";
import { AddLinkDialog } from "@/components/AddLinkDialog";
import { AskPanel } from "@/components/AskPanel";
import { StatusBadge, TypeBadge } from "@/components/badges";
import { CreateNote } from "@/components/CreateNote";
import { Editor, readPreview } from "@/components/Editor";
import { GenerateDialog } from "@/components/GenerateDialog";
import { GraphView } from "@/components/GraphView";
import { History } from "@/components/History";
import { IssueDialog } from "@/components/IssueDialog";
import { LinksPanel } from "@/components/LinksPanel";
import { DecryptDialog, EncryptDialog, LockedNote, PrivateBadge, RecipientsPanel } from "@/components/PrivateNote";
import { Markdown } from "@/components/Markdown";
import { SplitView } from "@/components/SplitView";
import { Badge, Button, Card, Dialog, DialogContent, ErrorBox, Field, Input, Select, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { useCollab } from "@/hooks/use-collab";
import { useRefreshAll } from "@/hooks/use-keys";
import { api, ApiError, errorMessage, idFromPath, noteApi, notePath, qs } from "@/lib/api";
import { can, useAuth } from "@/lib/auth";
import { relativeTime, splitFrontmatter, stripTitle } from "@/lib/frontmatter";
import { replaceYText } from "@/lib/generate";
import { appCanWrite } from "@/lib/repo";
import { useT } from "@/lib/i18n";
import { readStoredSide, storeSide } from "@/lib/split";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { AuditEntry, GenerateResult, GithubStatus, NoteDetail, NoteLinks, Subgraph, VaultSchema, WriteResult } from "@/lib/types";

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

/** An action under the title: icon and label, the label giving way to the icon alone on narrow screens (the name stays for screen readers). */
const Chip = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof Button> & { icon: LucideIcon; label: string }>(({ icon: Icon, label, className, ...p }, ref) => (
  <Button ref={ref} variant="outline" size="sm" aria-label={label} title={label} className={cn("rounded-full", className)} {...p}>
    <Icon className="size-4" aria-hidden />
    <span className="hidden sm:inline">{label}</span>
  </Button>
));
Chip.displayName = "Chip";

/** The first draft of a note created with a description: written straight into the editor, without a dialog. */
type AutoDraft = { state: "busy" } | { state: "done"; result: GenerateResult } | { state: "error"; message: string };

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
  const [encryptOpen, setEncryptOpen] = useState(false);
  const [decryptOpen, setDecryptOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  // The preview beside the editor: shown when the person chose so, else when the editor shows raw Markdown (Markdown source on).
  const [liveOn, setLiveOn] = useState(readPreview);
  const [sideChoice, setSideChoice] = useState(readStoredSide);
  const sideOn = sideChoice ?? !liveOn;
  const [generate, setGenerate] = useState<{ instruction: string } | null>(null);
  const [auto, setAuto] = useState<AutoDraft | null>(null);
  const briefTaken = useRef(false);
  const brief = useSearchParams().get("generate");
  const [newPath, setNewPath] = useState(id);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string>();
  const refreshAll = useRefreshAll();

  const n = note.data;
  const gh = useApi<GithubStatus>(n && can(me, "issues", n.space) && !n.private ? "/api/v1/github/status" : null);
  const writable = can(me, "write", n?.space);
  // The language model only writes into drafts, never into private notes, and only when the server has one.
  const canGenerate = writable && !!me?.capabilities.llm && n?.status === "draft" && !n.private && !n.locked;

  // Live editing: a shared document for public notes, when the server offers it. Private notes never are.
  const reloadAfterSave = async () => {
    await Promise.all([note.reload(), links.reload()]);
  };
  const collab = useCollab(me?.capabilities.collab && n && !n.private ? id : null, {
    selfName: me?.name,
    onSaved: ({ by, commit }) => {
      toast("ok", t("collab.savedBy", { name: by, commit: commit.slice(0, 7) }));
      void reloadAfterSave();
    },
  });
  const live = !!collab?.synced;
  const waiting = !!collab && !collab.synced && !collab.gaveUp;
  const dirty = live ? collab.dirty : draft !== undefined && n !== undefined && draft !== n.raw;
  const flatLinks = useMemo(() => Object.values(links.data?.outgoing ?? {}).flat(), [links.data]);

  useEffect(() => {
    if (!dirty || live) return; // a live draft is kept by the server: nothing to lose by leaving
    const on = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", on);
    return () => window.removeEventListener("beforeunload", on);
  }, [dirty, live]);

  useEffect(() => {
    if (tab === "edit" && n && draft === undefined && !live) setDraft(n.raw);
  }, [tab, n, draft, live]);

  const reload = async () => {
    await Promise.all([note.reload(), links.reload()]);
  };

  /** Put text in the editor without saving it: through the shared document when the editor is shared. */
  const putInEditor = (content: string) => {
    if (live) replaceYText(collab.text, content);
    else {
      setDraft(content);
      setEditorKey((k) => k + 1);
    }
  };
  const putRef = useRef(putInEditor);
  putRef.current = putInEditor;

  // A note created with a description gets its first draft at once, in the editor. The person already said what they
  // want: a second dialog asking again was one step too many. Nothing is saved, and the text can be taken out again.
  useEffect(() => {
    // Wait until the editor is the one that will stay: a shared one is not there on the first render, and text put in
    // the local draft meanwhile would be dropped when it arrives.
    const settling = !!me?.capabilities.collab && !!n && !n.private && (!collab || (!collab.synced && !collab.gaveUp));
    if (!brief || briefTaken.current || tab !== "edit" || !canGenerate || settling) return;
    briefTaken.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("generate");
    window.history.replaceState(null, "", url);
    setAuto({ state: "busy" });
    api
      .post<GenerateResult>(`${noteApi(id)}/generate`, { mode: "fill", instruction: brief })
      .then((result) => {
        putRef.current(result.content);
        setAuto({ state: "done", result });
      })
      .catch((e: unknown) => setAuto({ state: "error", message: e instanceof ApiError && e.status === 503 ? t("generate.noModel") : e instanceof ApiError && e.status === 403 ? t("generate.forbidden") : errorMessage(e) }));
  }, [brief, tab, canGenerate, me, n, collab, id, t]);

  /** The server changed the note's text (the link is in its frontmatter): an editor that holds the old text starts over from it. */
  const addedLink = async () => {
    await refreshAll();
    if (!live && draft !== undefined) {
      setDraft(undefined);
      setEditorKey((k) => k + 1);
    }
  };

  const editorText = live ? collab.text.toString() : (draft ?? n?.raw ?? "");
  const applyGenerated = (content: string) => {
    putInEditor(content);
    setGenerate(null);
    toast("ok", t("generate.applied"));
  };
  /** Back to the note as it is saved: the first draft was not what the person wanted. */
  const removeGenerated = () => {
    if (live) collab.replace(collab.base ?? n?.raw ?? "");
    else {
      setDraft(n?.raw);
      setEditorKey((k) => k + 1);
    }
    setAuto(null);
  };

  const save = async (overrideBase?: string) => {
    if (!n) return;
    const content = live ? collab.text.toString() : draft;
    if (content === undefined) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const base = overrideBase ?? (live ? collab.baseCommit : n.commit) ?? undefined;
      const r = await api.put<WriteResult>(noteApi(id), { content, base_commit: base });
      toast("ok", t("note.saved", { commit: r.commit.slice(0, 7) }));
      setConflict(undefined);
      await reload();
      // The editor you are in keeps going when it is shared; a private draft returns to reading as before.
      if (!live) {
        setDraft(undefined);
        setTab("read");
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Somebody else may have pressed Save with the same text a moment ago: then there is nothing to resolve.
        if (live) {
          await new Promise((r) => setTimeout(r, 400));
          if (!collab.dirty) {
            toast("ok", t("collab.alreadySaved", { name: collab.meta.get("savedBy") ?? "…" }));
            await reload();
            return;
          }
        }
        setConflict(String(e.extra["current"] ?? ""));
      } else setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  /** Throw away the unsaved text: for you alone when you edit on your own, for everybody when the editor is shared. */
  const discard = () => {
    if (live) {
      collab.replace(collab.base ?? n?.raw ?? "");
      setDiscardOpen(false);
    } else {
      setDraft(undefined);
      setEditorKey((k) => k + 1);
      setTab("read");
    }
  };

  const rename = async () => {
    setMoving(true);
    setMoveError(undefined);
    try {
      const r = await api.post<{ id: string; skipped: string[] }>(`${noteApi(id)}/rename`, { to: newPath.trim().replace(/\.md$/i, "") });
      toast("ok", t("note.renamed", { id: r.id }));
      if (r.skipped.length) toast("error", t("note.renameSkipped", { ids: r.skipped.join(", ") }));
      setRenameOpen(false);
      await refreshAll();
      router.push(notePath(r.id));
    } catch (e) {
      setMoveError(errorMessage(e));
    } finally {
      setMoving(false);
    }
  };

  const remove = async () => {
    setMoving(true);
    setMoveError(undefined);
    try {
      await api.del(`${noteApi(id)}${qs({ base_commit: n?.commit ?? undefined })}`);
      toast("ok", t("note.deleted"));
      setDeleteOpen(false);
      await refreshAll();
      router.push("/");
    } catch (e) {
      setMoveError(errorMessage(e));
    } finally {
      setMoving(false);
    }
  };

  /** Take the saved version over the text in the editor (after a conflict). */
  const loadTheirs = async () => {
    const fresh = await api.get<NoteDetail>(noteApi(id));
    if (live) collab.rebase(fresh.raw, fresh.commit);
    else {
      setDraft(undefined);
      setEditorKey((k) => k + 1);
    }
    setConflict(undefined);
    toast("ok", t("collab.loaded"));
    await reload();
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

  const tabsToShow = TABS.filter((x) => (x === "edit" ? writable && !n.locked : x === "audit" ? !!audit.data : true));
  const preview = live ? splitFrontmatter(collab.content).body : draft !== undefined ? splitFrontmatter(draft).body : n.body;
  const people = collab?.peers ?? [];
  const toggle = () => {
    setSideChoice(!sideOn);
    storeSide(!sideOn);
  };
  const flatIncoming = Object.values(links.data?.incoming ?? {}).flat().length;
  // Someone who can change the status sees it once, in the control that changes it.
  const statusEditable = writable && !!schema.data && !n.locked;
  /** Saving and generating sit in the editor's toolbar: one bar above the text instead of two. */
  const toolbarEnd = (
    <>
      {canGenerate && (
        <Button size="sm" variant="ghost" onClick={() => setGenerate({ instruction: "" })}>
          <Sparkles className="size-4" aria-hidden />
          {t("generate.open")}
        </Button>
      )}
      {/* an icon: the label is long, and one bar must hold everything on a laptop screen */}
      <Button size="sm" variant="ghost" aria-label={live ? t("collab.discard") : t("cancel")} title={live ? t("collab.discard") : t("cancel")} onClick={() => (live ? setDiscardOpen(true) : discard())} disabled={live && !dirty}>
        <X className="size-4" aria-hidden />
      </Button>
      <Button size="sm" onClick={() => void save()} disabled={saving || !dirty} title={live ? t("collab.sharedHint") : t("note.saveHint")}>
        <Save className="size-4" aria-hidden />
        {t("note.save")}
      </Button>
    </>
  );

  return (
    <div>
      <article className="min-w-0">
        <Breadcrumb ariaLabel={t("note.breadcrumb")} items={[{ label: t("vault.root"), href: "/vault/" }, ...n.id.split("/").slice(0, -1).map((part, i, all) => ({ label: part, href: `/vault/${qs({ q: `${all.slice(0, i + 1).join("/")}/` })}` })), { label: n.id.split("/").at(-1) ?? n.id }]} />
        <header className="mb-3 mt-3">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">{n.title}</h1>
          {/* One line: what the note is, who is in it, when it changed. The path is in the breadcrumb, the status in its own control. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <TypeBadge type={n.type} />
            {!statusEditable && <StatusBadge status={n.status} />}
            {n.private && <PrivateBadge />}
            <Badge tone="muted">{n.space}</Badge>
            {n.tags.map((tag) => (
              <Badge key={tag} tone="muted">#{tag}</Badge>
            ))}
            {collab && (
              <>
                <Badge key={collab.status} tone={collab.status === "connected" ? "success" : "muted"} title={collab.status === "connected" ? t("collab.sharedHint") : undefined}>
                  {collab.status === "connected" ? t("collab.live") : collab.status === "connecting" ? t("collab.connecting") : t("collab.offline")}
                </Badge>
                {people.length > 0 && <AvatarGroup members={people.map((p) => ({ name: p.name, status: "online" as const }))} size="sm" label={`${t("collab.people")}: ${people.map((p) => p.name).join(", ")}`} />}
              </>
            )}
            <p className="text-sm text-muted-foreground">
              {n.owner ?? "—"} · {t("note.updated", { when: relativeTime(n.updated_at, lang) })}
              {n.commit && <> · <code>{n.commit.slice(0, 7)}</code></>}
            </p>
          </div>
        </header>

        <div role="group" aria-label={t("note.actions")} className="mb-5 flex flex-wrap items-center gap-2">
          {statusEditable && schema.data && (
            <Select aria-label={t("note.status")} className="!h-8 !w-auto !rounded-full !px-3 !pr-8 text-xs" value={n.status ?? ""} onChange={(e) => void changeStatus(e.target.value)}>
              {!n.status && <option value="" />}
              {schema.data.statuses.map((s) => <option key={s} value={s}>{t(`status.${s}` as never)}</option>)}
            </Select>
          )}
          {writable && (
            <>
              <Chip icon={FolderInput} label={t("note.rename")} onClick={() => { setNewPath(n.id); setMoveError(undefined); setRenameOpen(true); }} />
              <Chip icon={Trash2} label={t("note.delete")} onClick={() => { setMoveError(undefined); setDeleteOpen(true); }} />
            </>
          )}
          {writable && !n.private && <Chip icon={Lock} label={t("private.encryptAction")} onClick={() => setEncryptOpen(true)} />}
          {n.private && !n.locked && (
            <>
              {writable && <Chip icon={Unlock} label={t("private.decryptAction")} onClick={() => setDecryptOpen(true)} />}
              <Chip
                icon={Lock}
                label={t("private.lockNow")}
                onClick={async () => {
                  await api.post("/api/v1/keys/lock");
                  await refreshAll();
                }}
              />
            </>
          )}
          {can(me, "issues", n.space) && !n.private && appCanWrite(gh.data, "issues") && <Chip icon={CircleDot} label={t("issue.open")} onClick={() => setIssueOpen(true)} />}
          <Popover open={linksOpen} onOpenChange={setLinksOpen}>
            <PopoverTrigger asChild>
              <Chip icon={Link2} label={t("note.links", { n: flatLinks.length + flatIncoming })} />
            </PopoverTrigger>
            <PopoverContent aria-label={t("note.links", { n: flatLinks.length + flatIncoming })} className="!max-w-[min(28rem,calc(100vw-20px))] max-h-[70vh] w-[28rem] overflow-y-auto">
              {links.loading && !links.data ? <Spinner label={t("loading")} /> : links.data ? <LinksPanel links={links.data} onAdd={writable && !n.locked ? () => { setLinksOpen(false); setAddLinkOpen(true); } : undefined} addHint={dirty ? t("addlink.saveFirst") : undefined} /> : links.error ? <ErrorBox>{errorMessage(links.error)}</ErrorBox> : null}
            </PopoverContent>
          </Popover>
          {tab !== "edit" && (
          <Popover open={propsOpen} onOpenChange={setPropsOpen}>
            <PopoverTrigger asChild>
              <Chip icon={SlidersHorizontal} label={t("note.properties")} />
            </PopoverTrigger>
            <PopoverContent aria-label={t("note.properties")} className="!max-w-[min(28rem,calc(100vw-20px))] max-h-[70vh] w-[28rem] overflow-y-auto">
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
            </PopoverContent>
          </Popover>
          )}
        </div>
        {n.private && (
          <Card className="mb-5">
            <RecipientsPanel note={n} writable={writable} onChanged={() => void reload()} />
          </Card>
        )}

        {n.locked ? (
          <LockedNote note={n} />
        ) : (
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
            <div className="max-w-[52rem]">
              <Markdown source={stripTitle(n.body, n.title)} links={flatLinks} noteId={id} />
            </div>
          </TabsContent>

          <TabsContent value="edit" className="pt-5">
            {writable && waiting && <Spinner label={t("loading")} />}
            {writable && !waiting && (live || draft !== undefined) && (
              <div className="space-y-3">
                {conflict !== undefined && (
                  <div role="alert" className="space-y-2 rounded-lg border-2 border-warning p-3 text-sm">
                    <p className="font-medium">{t("conflict.title")}</p>
                    <p>{t("conflict.body", { commit: conflict.slice(0, 7) })}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => void loadTheirs()}>
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
                {live && collab.stale !== null && conflict === undefined && (
                  <div role="status" className="space-y-2 rounded-lg border-2 border-warning p-3 text-sm">
                    <p>{t("collab.stale", { commit: collab.stale.slice(0, 7) })}</p>
                    <Button size="sm" variant="outline" onClick={() => void loadTheirs()}>
                      {t("collab.loadTheirs")}
                    </Button>
                  </div>
                )}
                {saveError && <ErrorBox>{saveError}</ErrorBox>}
                {auto?.state === "busy" && (
                  <div className="rounded-lg border p-3">
                    <Spinner label={t("generate.autoBusy")} />
                  </div>
                )}
                {auto?.state === "error" && (
                  <div className="space-y-2">
                    <ErrorBox>{auto.message}</ErrorBox>
                    <Button size="sm" variant="ghost" onClick={() => setAuto(null)}>{t("close")}</Button>
                  </div>
                )}
                {auto?.state === "done" && (
                  <div role="status" className="space-y-2 rounded-lg border p-3 text-sm">
                    <p className="font-medium">{t("generate.autoDone", { model: auto.result.model })}</p>
                    {auto.result.warnings.length > 0 && (
                      <ul className="list-disc pl-5">
                        {auto.result.warnings.map((w) => <li key={w}>{w}</li>)}
                      </ul>
                    )}
                    {auto.result.grounded_on.length > 0 && (
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{t("generate.grounded")}</span>
                        {auto.result.grounded_on.map((g) => (
                          <Link key={g.id} href={notePath(g.id)} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">{g.title}</Link>
                        ))}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setAuto(null)}>{t("generate.autoKeep")}</Button>
                      <Button size="sm" variant="ghost" onClick={removeGenerated}>{t("generate.autoRemove")}</Button>
                    </div>
                  </div>
                )}
                <SplitView
                  main={
                    live ? (
                      <Editor key="live" noteId={id} onError={(e) => toast("error", errorMessage(e))} value="" collab={{ text: collab.text, awareness: collab.awareness }} onChange={() => undefined} onSave={() => void save()} linkTypes={schema.data?.linkTypes ?? []} label={t("note.editor")} side={{ on: sideOn, toggle }} onLivePreview={setLiveOn} toolbarEnd={toolbarEnd} />
                    ) : (
                      <Editor key={editorKey} noteId={id} onError={(e) => toast("error", errorMessage(e))} value={draft ?? ""} onChange={setDraft} onSave={() => void save()} linkTypes={schema.data?.linkTypes ?? []} label={t("note.editor")} side={{ on: sideOn, toggle }} onLivePreview={setLiveOn} toolbarEnd={toolbarEnd} />
                    )
                  }
                  side={
                    sideOn ? (
                      <div className="min-w-0 rounded-xl border p-4">
                        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("note.preview")}</h2>
                        <Markdown source={preview} links={flatLinks} noteId={id} />
                      </div>
                    ) : null
                  }
                />
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
        )}
      </article>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent title={t("note.renameTitle")} description={t("note.renameBody")} closeLabel={t("close")}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
            <Field label={t("note.newPath")} id="rename-path">
              <Input id="rename-path" value={newPath} onChange={(e) => setNewPath(e.target.value)} required autoFocus />
            </Field>
            {moveError && <ErrorBox>{moveError}</ErrorBox>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRenameOpen(false)}>{t("cancel")}</Button>
              <Button type="submit" disabled={moving || !newPath.trim() || newPath.trim() === id}>{t("note.renameConfirm")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent title={t("note.deleteTitle")} description={t("note.deleteBody")} closeLabel={t("close")}>
          <div className="space-y-3">
            {flatIncoming > 0 && <p className="text-sm">{t("note.deleteLinks", { n: flatIncoming })}</p>}
            {moveError && <ErrorBox>{moveError}</ErrorBox>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t("cancel")}</Button>
              <Button variant="destructive" disabled={moving} onClick={() => void remove()}>{t("note.deleteConfirm")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <EncryptDialog id={id} open={encryptOpen} onOpenChange={setEncryptOpen} onDone={() => void refreshAll()} />
      <DecryptDialog id={id} open={decryptOpen} onOpenChange={setDecryptOpen} onDone={() => void refreshAll()} />
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent title={t("collab.discardTitle")} description={t("collab.discardBody")} closeLabel={t("close")}>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={discard}>{t("collab.discardConfirm")}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <AddLinkDialog id={id} linkTypes={schema.data?.linkTypes ?? []} open={addLinkOpen} onOpenChange={setAddLinkOpen} onAdded={() => void addedLink()} />
      {generate && <GenerateDialog id={id} current={editorText} stored={n.raw} instruction={generate.instruction} onApply={applyGenerated} onClose={() => setGenerate(null)} />}
      <IssueDialog id={id} title={n.title} space={n.space} open={issueOpen} onOpenChange={setIssueOpen} onCreated={() => void links.reload()} />
    </div>
  );
}
