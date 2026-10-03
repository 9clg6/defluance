"use client";

import { Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { KeysPanel } from "@/components/KeysPanel";
import { TemplatesPanel } from "@/components/TemplatesPanel";
import { Badge, Button, Card, ErrorBox, Field, Input, Select, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { api, errorMessage, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { relativeTime } from "@/lib/frontmatter";
import { useT } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import type { GithubStatus, IndexStatus, TokenRow } from "@/lib/types";

const SCOPES = ["read", "write", "issues", "admin"] as const;
const ROLES = ["reader", "editor", "admin"] as const;

function Tokens() {
  const { t, tr, lang } = useT();
  const { me } = useAuth();
  const toast = useToast();
  const tokens = useApi<TokenRow[]>("/api/v1/tokens");
  const adminSpaces = (me?.spaces ?? []).filter((s) => s.perms.includes("admin")).map((s) => s.name);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [spaces, setSpaces] = useState<string[]>([]);
  const [days, setDays] = useState("90");
  const [withKey, setWithKey] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<string>();
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const create = async () => {
    setError(undefined);
    try {
      const r = await api.post<{ token: string }>("/api/v1/tokens", { name: name.trim(), scopes, spaces, ...(days ? { expires_in_days: Number(days) } : {}), ...(withKey ? { private_key: true } : {}) });
      setCreated(r.token);
      setName("");
      await tokens.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="space-y-6">
      {created && (
        <Card className="space-y-3 border-primary">
          <p className="font-medium">{t("tokens.once")}</p>
          <code className="block break-all rounded-lg bg-muted p-3 text-sm">{created}</code>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={created} label={t("copy")} />
            <CopyButton text={`claude mcp add --transport http defluance ${origin}/mcp --header "Authorization: Bearer ${created}"`} label={t("tokens.copyMcp")} />
          </div>
          <p className="text-xs text-muted-foreground">{t("tokens.mcpHelp")}</p>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-heading text-lg font-semibold">{t("tokens.new")}</h2>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <Field label={t("tokens.name")} id="tk-name" hint={t("tokens.nameHint")}>
            <Input id="tk-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} className="max-w-sm" />
          </Field>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t("tokens.scopes")}</legend>
            <div className="flex flex-wrap gap-4">
              {SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={scopes.includes(s)} onChange={() => setScopes(toggle(scopes, s))} />
                  <span>{tr("perm", s)}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("tokens.scopesHint")}</p>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t("tokens.spaces")}</legend>
            <div className="flex flex-wrap gap-4">
              {adminSpaces.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={spaces.includes(s)} onChange={() => setSpaces(toggle(spaces, s))} />
                  <span>{s}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t("tokens.spacesHint")}</p>
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={withKey} onChange={(e) => setWithKey(e.target.checked)} />
            <span>
              {t("tokens.withKey")}
              <span className="block text-xs text-muted-foreground">{t("tokens.withKeyHint")}</span>
            </span>
          </label>
          <Field label={t("tokens.expires")} id="tk-days">
            <Input id="tk-days" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} className="w-28" />
          </Field>
          {error && <ErrorBox>{error}</ErrorBox>}
          <Button type="submit" disabled={!name.trim() || scopes.length === 0}>{t("tokens.create")}</Button>
        </form>
      </Card>

      <section aria-labelledby="tk-list">
        <h2 id="tk-list" className="mb-2 font-heading text-lg font-semibold">{t("tokens.list")}</h2>
        {tokens.loading && <Spinner label={t("loading")} />}
        {tokens.error && <ErrorBox>{errorMessage(tokens.error)}</ErrorBox>}
        <ul className="space-y-2">
          {tokens.data?.map((tk) => (
            <li key={tk.id} className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
              <span className="font-medium">{tk.name}</span>
              {tk.scopes.map((s) => <Badge key={s} tone="muted">{tr("perm", s)}</Badge>)}
              <Badge tone="muted">{tk.spaces.length ? tk.spaces.join(", ") : t("tokens.allSpaces")}</Badge>
              <span className="text-xs text-muted-foreground">
                {tk.last_used_at ? t("tokens.lastUsed", { when: relativeTime(tk.last_used_at, lang) }) : t("tokens.neverUsed")}
                {tk.expires_at && ` · ${t("tokens.expiresOn", { when: new Date(tk.expires_at).toLocaleDateString(lang) })}`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive"
                aria-label={t("tokens.revokeNamed", { name: tk.name })}
                onClick={async () => {
                  if (!window.confirm(t("tokens.confirmRevoke", { name: tk.name }))) return;
                  try {
                    await api.del(`/api/v1/tokens/${tk.id}`);
                    toast("ok", t("tokens.revoked"));
                    await tokens.reload();
                  } catch (e) {
                    toast("error", errorMessage(e));
                  }
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                {t("tokens.revoke")}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Members() {
  const { t, tr } = useT();
  const { me } = useAuth();
  const toast = useToast();
  const adminSpaces = (me?.spaces ?? []).filter((s) => s.perms.includes("admin")).map((s) => s.name);
  const [space, setSpace] = useState("");
  const current = space || adminSpaces[0] || "";
  const members = useApi<{ login: string; name: string | null; role: string }[]>(current ? `/api/v1/spaces/${encodeURIComponent(current)}/members` : null);
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<string>("editor");

  if (!adminSpaces.length) return <p className="text-sm text-muted-foreground">{t("members.noAdmin")}</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("members.help")}</p>
      <div>
        <label htmlFor="m-space" className="mb-1 block text-sm font-medium">{t("members.space")}</label>
        <Select id="m-space" value={current} onChange={(e) => setSpace(e.target.value)}>
          {adminSpaces.map((s) => <option key={s}>{s}</option>)}
        </Select>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.put(`/api/v1/spaces/${encodeURIComponent(current)}/members`, { login: login.trim(), role });
            setLogin("");
            await members.reload();
          } catch (err) {
            toast("error", errorMessage(err));
          }
        }}
      >
        <Field label={t("members.login")} id="m-login">
          <Input id="m-login" value={login} onChange={(e) => setLogin(e.target.value)} required className="w-52" />
        </Field>
        <Field label={t("members.role")} id="m-role">
          <Select id="m-role" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{tr("role", r)}</option>)}
          </Select>
        </Field>
        <Button type="submit" disabled={!login.trim()}>{t("members.add")}</Button>
      </form>
      {members.error && <ErrorBox>{errorMessage(members.error)}</ErrorBox>}
      <ul className="space-y-2">
        {members.data?.length === 0 && <li className="text-sm text-muted-foreground">{t("members.none")}</li>}
        {members.data?.map((m) => (
          <li key={m.login} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-2 text-sm">
            <span className="font-medium">{m.login}</span>
            <Badge tone="muted">{tr("role", m.role)}</Badge>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-destructive"
              aria-label={t("members.removeNamed", { name: m.login })}
              onClick={async () => {
                try {
                  await api.del(`/api/v1/spaces/${encodeURIComponent(current)}/members${qs({ login: m.login })}`);
                  await members.reload();
                } catch (e) {
                  toast("error", errorMessage(e));
                }
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              {t("members.remove")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Github() {
  const { t } = useT();
  const { me } = useAuth();
  const toast = useToast();
  const gh = useApi<GithubStatus>("/api/v1/github/status");
  const [busy, setBusy] = useState(false);
  const isAdmin = !!me?.spaces.some((s) => s.perms.includes("admin"));
  const base = gh.data?.webhookUrl.replace(/\/webhooks\/github$/, "") ?? "";
  const snippet = "spaces:\n  - { name: product, path: product, repos: [your-org/your-repo] }\nrepos: [your-org/your-repo]\nderive_status: true   # merged PR: approved -> implemented\npr_comments: false     # comment on PRs with the specs they touch";

  if (gh.loading) return <Spinner label={t("loading")} />;
  if (gh.error) return <ErrorBox>{errorMessage(gh.error)}</ErrorBox>;
  const s = gh.data as GithubStatus;

  const step = (n: number, title: string, body: React.ReactNode) => (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden>{n}</span>
      <div className="space-y-1 text-sm">
        <h3 className="font-medium">{title}</h3>
        {body}
      </div>
    </li>
  );

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center gap-3">
        <Badge tone={s.configured ? "success" : "warning"}>{s.configured ? t("gh.connected") : t("gh.notConnected")}</Badge>
        {s.configured ? <span className="text-sm">{t("gh.reposCount", { n: s.repos.length })}: {s.repos.join(", ") || "—"}</span> : <span className="text-sm text-muted-foreground">{t("gh.followSteps")}</span>}
        {s.configured && isAdmin && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.post<{ issues: number; pulls: number }>("/api/v1/github/resync");
                toast("ok", t("gh.synced", { issues: r.issues, pulls: r.pulls }));
              } catch (e) {
                toast("error", errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("gh.resync")}
          </Button>
        )}
      </Card>

      <ol className="space-y-5">
        {step(1, t("gh.s1"), (
          <>
            <p>{t("gh.s1b")}</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              <li>{t("gh.s1perm")}</li>
              <li>{t("gh.s1events")}</li>
            </ul>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <code className="rounded bg-muted px-2 py-1">{s.webhookUrl}</code>
              <CopyButton text={s.webhookUrl} label={t("copy")} />
              <a className="text-primary underline underline-offset-2" href="https://github.com/settings/apps/new" target="_blank" rel="noopener noreferrer">{t("gh.newApp")}</a>
            </div>
          </>
        ))}
        {step(2, t("gh.s2"), (
          <>
            <p>{t("gh.s2b")}</p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs"><code>{"GITHUB_APP_ID=123456\nGITHUB_APP_PRIVATE_KEY=\"-----BEGIN RSA PRIVATE KEY-----\\n...\"\nGITHUB_WEBHOOK_SECRET=<the secret you chose>"}</code></pre>
          </>
        ))}
        {step(3, t("gh.s3"), <p>{t("gh.s3b")}</p>)}
        {step(4, t("gh.s4"), (
          <>
            <p>{t("gh.s4b")}</p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs"><code>{snippet}</code></pre>
          </>
        ))}
        {step(5, t("gh.s5"), (
          <>
            <p>{t("gh.s5b")}</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <code className="rounded bg-muted px-2 py-1">{base}/auth/github/callback</code>
              <CopyButton text={`${base}/auth/github/callback`} label={t("copy")} />
              <Badge tone={s.oauth ? "success" : "muted"}>{s.oauth ? t("gh.oauthOn") : t("gh.oauthOff")}</Badge>
            </div>
          </>
        ))}
      </ol>
      {s.spaces.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">{t("gh.mapping")}</h3>
          <ul className="space-y-1 text-sm">
            {s.spaces.map((sp) => <li key={sp.name}><strong>{sp.name}</strong> → {sp.repos.join(", ") || s.defaultRepos.join(", ") || "—"}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

function About() {
  const { t } = useT();
  const status = useApi<IndexStatus>("/api/v1/index/status");
  const [health, setHealth] = useState<{ status: string; checks: Record<string, string> }>();
  useEffect(() => {
    fetch("/health").then((r) => r.json()).then(setHealth).catch(() => undefined);
  }, []);
  return (
    <div className="space-y-4 text-sm">
      <Card className="space-y-1">
        <h2 className="font-heading text-lg font-semibold">{t("about.system")}</h2>
        {health && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">{t("about.status")}</dt><dd>{health.status}</dd>
            {Object.entries(health.checks).map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        )}
      </Card>
      {status.data && (
        <Card>
          <h2 className="mb-1 font-heading text-lg font-semibold">{t("about.index")}</h2>
          <p>{t("about.indexLine", { notes: status.data.notes, chunks: status.data.chunks, edges: status.data.edges, embedded: status.data.embedded })}</p>
          <p className="text-muted-foreground">{status.data.embed_model ? t("about.embed", { model: status.data.embed_model }) : t("about.noEmbed")}</p>
          {(status.data.jobs_failed > 0) && <p className="text-destructive">{t("about.failedJobs", { n: status.data.jobs_failed })}</p>}
        </Card>
      )}
      {status.data && (
        <Card>
          <h2 className="mb-1 font-heading text-lg font-semibold">{t("about.search")}</h2>
          <p>{status.data.capabilities.semantic ? t("about.searchMeaning", { model: status.data.capabilities.embedder }) : t("about.searchWords")}</p>
          <p className="text-muted-foreground">{status.data.capabilities.llm ? t("about.llmOn", { model: status.data.capabilities.llm }) : t("about.llmOff")}</p>
        </Card>
      )}
      <Card>
        <h2 className="mb-1 font-heading text-lg font-semibold">{t("about.license")}</h2>
        <p className="text-muted-foreground">{t("about.licenseBody")}</p>
      </Card>
    </div>
  );
}

const SETTINGS_TABS = ["tokens", "members", "github", "private", "templates", "about"];

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const { t } = useT();
  const requested = useSearchParams().get("tab") ?? "";
  const [tab, setTab] = useState(SETTINGS_TABS.includes(requested) ? requested : "tokens");
  return (
    <div className="space-y-4">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("settings.title")}</h1>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t("settings.title")}>
          <TabsTrigger value="tokens">{t("settings.tokens")}</TabsTrigger>
          <TabsTrigger value="members">{t("settings.members")}</TabsTrigger>
          <TabsTrigger value="github">GitHub</TabsTrigger>
          <TabsTrigger value="private">{t("private.title")}</TabsTrigger>
          <TabsTrigger value="templates">{t("settings.templates")}</TabsTrigger>
          <TabsTrigger value="about">{t("settings.about")}</TabsTrigger>
        </TabsList>
        <TabsContent value="tokens" className="pt-5"><Tokens /></TabsContent>
        <TabsContent value="members" className="pt-5"><Members /></TabsContent>
        <TabsContent value="github" className="pt-5"><Github /></TabsContent>
        <TabsContent value="private" className="pt-5"><KeysPanel /></TabsContent>
        <TabsContent value="templates" className="pt-5"><TemplatesPanel /></TabsContent>
        <TabsContent value="about" className="pt-5"><About /></TabsContent>
      </Tabs>
    </div>
  );
}
