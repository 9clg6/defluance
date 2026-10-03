import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { note, FILES, makeServer, type TestServer } from "../test-env.js";
import { GithubClient } from "./client.js";
import { GithubService, verifySignature } from "./service.js";

const SECRET = "whsec_test";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

interface Call {
  method: string;
  path: string;
  auth: string | null;
  body: any;
}

function githubMock() {
  const calls: Call[] = [];
  const state = {
    issues: {} as Record<string, any[]>,
    pulls: {} as Record<string, any>,
    files: {} as Record<string, string[]>,
    comments: [] as { id: number; body: string }[],
    nextIssue: 77,
  };
  const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const auth = (init?.headers as Record<string, string> | undefined)?.["authorization"] ?? null;
    calls.push({ method, path: u.pathname + u.search, auth, body });
    const p = u.pathname;
    if (/^\/repos\/[^/]+\/[^/]+\/installation$/.test(p)) return reply({ id: 1 });
    if (p === "/app/installations") return reply([{ id: 1 }]);
    if (p === "/app/installations/1/access_tokens") return reply({ token: "ghs_inst", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (p === "/installation/repositories") return reply({ repositories: [{ full_name: "acme/app" }, { full_name: "acme/default" }] });
    let m = /^\/repos\/([^/]+\/[^/]+)\/issues$/.exec(p);
    if (m && method === "POST") {
      const n = state.nextIssue++;
      return reply({ number: n, html_url: `https://github.com/${m[1]}/issues/${n}` }, 201);
    }
    if (m && method === "GET") return reply(state.issues[m[1] as string] ?? []);
    m = /^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)\/files$/.exec(p);
    if (m) return reply((state.files[`${m[1]}#${m[2]}`] ?? []).map((filename) => ({ filename })));
    m = /^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(p);
    if (m) return reply(state.pulls[`${m[1]}#${m[2]}`] ?? {}, state.pulls[`${m[1]}#${m[2]}`] ? 200 : 404);
    m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/.exec(p);
    if (m && method === "GET") return reply(state.comments);
    if (m && method === "POST") {
      state.comments.push({ id: state.comments.length + 1, body: body.body });
      return reply({ id: state.comments.length }, 201);
    }
    m = /^\/repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/.exec(p);
    if (m && method === "PATCH") {
      const c = state.comments.find((x) => x.id === Number(m?.[1]));
      if (c) c.body = body.body;
      return reply({ id: c?.id });
    }
    return reply({ message: "not found" }, 404);
  }) as typeof fetch;
  return { fetch: fetchMock, calls, state };
}

const issuePayload = (n: number, extra: Record<string, unknown> = {}) => ({ number: n, title: `Issue ${n}`, state: "open", labels: [{ name: "spec" }], user: { login: "ana" }, html_url: `https://github.com/acme/app/issues/${n}`, updated_at: "2026-10-05T10:00:00Z", ...extra });
const prPayload = (n: number, extra: Record<string, unknown> = {}) => ({ number: n, title: `PR ${n}`, state: "open", merged: false, labels: [], user: { login: "karim" }, html_url: `https://github.com/acme/app/pull/${n}`, updated_at: "2026-10-05T11:00:00Z", ...extra });

async function setup(opts: { config?: string; files?: Record<string, string> } = {}) {
  const mock = githubMock();
  const s = await makeServer({
    files: { ...FILES, ...(opts.files ?? {}), ".defluance/config.yaml": FILES[".defluance/config.yaml"] + (opts.config ?? "") },
    fetch: mock.fetch,
    github: (ctx) => new GithubService(ctx, new GithubClient({ appId: "123", privateKey, apiUrl: "https://api.github.com", fetch: mock.fetch }), SECRET),
  });
  const send = async (event: string, payload: unknown, secret = SECRET) => {
    const body = JSON.stringify(payload);
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const res = await s.request("/webhooks/github", { method: "POST", headers: { "x-github-event": event, "x-github-delivery": crypto.randomUUID(), "x-hub-signature-256": signature }, body });
    await s.flush();
    return res;
  };
  return { s, mock, send };
}

const ctxPending = (s: TestServer) => s.ctx.jobs.pending();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});
const track = async <T extends { s: TestServer }>(p: Promise<T>) => {
  const v = await p;
  cleanups.push(() => v.s.cleanup());
  return v;
};

describe("signatures and App JWT", () => {
  const sig = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  it("accepts only the exact HMAC of the raw body", () => {
    expect(verifySignature(SECRET, "{}", sig("{}"))).toBe(true);
    expect(verifySignature(SECRET, "{ }", sig("{}"))).toBe(false);
    expect(verifySignature(SECRET, "{}", sig("{}", "other"))).toBe(false);
    expect(verifySignature(SECRET, "{}", null)).toBe(false);
    expect(verifySignature(SECRET, "{}", "sha256=zz")).toBe(false);
    expect(verifySignature(SECRET, "{}", sig("{}").replace("sha256=", ""))).toBe(false);
  });

  it("signs a verifiable RS256 JWT carrying the app id", () => {
    const jwt = new GithubClient({ appId: "123", privateKey: privateKey.replace(/\n/g, "\\n"), now: () => 1_800_000_000_000 }).appJwt();
    const [h, p, s] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(claims).toEqual({ iat: 1_800_000_000 - 60, exp: 1_800_000_000 - 60 + 600, iss: "123" });
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
});

describe("webhooks", () => {
  it("rejects bad signatures, answers ping, ignores unknown events", async () => {
    const { s, send } = await track(setup());
    expect((await send("issues", { action: "opened" }, "wrong-secret")).status).toBe(401);
    expect((await send("ping", { zen: "x" })).status).toBe(200);
    expect((await send("star", {})).status).toBe(202);
    const bad = await s.request("/webhooks/github", { method: "POST", headers: { "x-github-event": "issues", "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update("nope").digest("hex")}` }, body: "nope" });
    expect(bad.status).toBe(400);
  });

  it("queues a redelivered webhook once", async () => {
    const { s } = await track(setup());
    const body = JSON.stringify({ action: "opened", repository: { full_name: "acme/app" }, issue: issuePayload(31) });
    const signature = `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
    const deliver = (id: string) => s.request("/webhooks/github", { method: "POST", headers: { "x-github-event": "issues", "x-github-delivery": id, "x-hub-signature-256": signature }, body });
    const first = await deliver("delivery-1");
    expect([first.status, await first.text()]).toEqual([202, "queued"]);
    const again = await deliver("delivery-1");
    expect([again.status, await again.text()]).toEqual([200, "duplicate"]);
    expect(await ctxPending(s)).toBe(1);
    expect((await deliver("delivery-2")).status).toBe(202); // a different delivery is a different event
  });

  it("caches an issue and resolves gh: links to it with its state", async () => {
    const { s, send } = await track(setup());
    await s.call("POST", `/api/v1/notes/${encodeURIComponent("produit/password-reset")}/links`, { body: { to: "gh:acme/app#12", type: "tracked_by" } });
    expect((await send("issues", { action: "opened", repository: { full_name: "acme/app" }, issue: issuePayload(12) })).status).toBe(202);

    const node = await s.call("GET", "/api/v1/github/nodes/acme/app/12");
    expect(node.body).toMatchObject({ key: "acme/app#12", kind: "issue", state: "open", title: "Issue 12", labels: ["spec"], author: "ana" });
    const links = (await s.call("GET", `/api/v1/notes/${encodeURIComponent("produit/password-reset")}/links`)).body;
    expect(links.outgoing["tracked_by"][0]).toMatchObject({ kind: "github", target: "gh:acme/app#12", broken: false, github: { state: "open", title: "Issue 12" } });

    await send("issues", { action: "closed", repository: { full_name: "acme/app" }, issue: issuePayload(12, { state: "closed" }) });
    expect((await s.call("GET", "/api/v1/github/nodes/acme/app/12")).body.state).toBe("closed");
    expect((await s.call("GET", "/api/v1/github/nodes/acme/app/999")).status).toBe(404);
  });

  it("caches a pull request with its files", async () => {
    const { s, send, mock } = await track(setup());
    mock.state.files["acme/app#5"] = ["src/auth/login.ts", "README.md"];
    await send("pull_request", { action: "opened", repository: { full_name: "acme/app" }, pull_request: prPayload(5) });
    const node = (await s.call("GET", "/api/v1/github/nodes/acme/app/5")).body;
    expect(node).toMatchObject({ kind: "pull-request", state: "open", files: ["src/auth/login.ts", "README.md"] });
    expect(mock.calls.find((c) => c.path.includes("/access_tokens"))?.auth).toMatch(/^Bearer eyJ/);
    expect(mock.calls.find((c) => c.path.includes("/pulls/5/files"))?.auth).toBe("Bearer ghs_inst");
  });
});

describe("status derived from merged pull requests", () => {
  const tracked = async (s: TestServer, id: string, key: string) => s.call("POST", `/api/v1/notes/${encodeURIComponent(id)}/links`, { body: { to: `gh:${key}`, type: "tracked_by" } });
  const merged = (n: number) => ({ action: "closed", repository: { full_name: "acme/app" }, pull_request: prPayload(n, { state: "closed", merged: true, merged_at: "2026-10-05T12:00:00Z" }) });

  it("moves approved notes to implemented with a bot commit, and leaves others alone", async () => {
    const { s, send } = await track(setup());
    await tracked(s, "produit/auth-login", "acme/app#8"); // approved
    await tracked(s, "produit/password-reset", "acme/app#8"); // draft
    await send("pull_request", merged(8));
    expect((await s.call("GET", `/api/v1/notes/${encodeURIComponent("produit/auth-login")}`)).body.status).toBe("implemented");
    expect((await s.call("GET", `/api/v1/notes/${encodeURIComponent("produit/password-reset")}`)).body.status).toBe("draft");
    expect(s.git("log", "-1", "--format=%an|%s")).toBe("defluance-bot|status produit/auth-login: implemented (acme/app#8 merged)\n");
    const log = (await s.call("GET", "/api/v1/audit?action=status.derive")).body;
    expect(log[0]).toMatchObject({ target: "produit/auth-login", actor_name: "defluance-bot", payload: { pr: "acme/app#8", from: "approved", to: "implemented" } });
    // same event twice: nothing left to change
    const before = s.git("rev-parse", "HEAD");
    await send("pull_request", merged(8));
    expect(s.git("rev-parse", "HEAD")).toBe(before);
  });

  it("does nothing for a closed but unmerged PR, or when derive_status is off", async () => {
    const { s, send } = await track(setup());
    await tracked(s, "produit/auth-login", "acme/app#9");
    await send("pull_request", { action: "closed", repository: { full_name: "acme/app" }, pull_request: prPayload(9, { state: "closed", merged: false }) });
    expect((await s.call("GET", `/api/v1/notes/${encodeURIComponent("produit/auth-login")}`)).body.status).toBe("approved");

    const off = await track(setup({ config: "derive_status: false\n" }));
    await tracked(off.s, "produit/auth-login", "acme/app#8");
    await off.send("pull_request", merged(8));
    expect((await off.s.call("GET", `/api/v1/notes/${encodeURIComponent("produit/auth-login")}`)).body.status).toBe("approved");
  });
});

describe("impact of a pull request", () => {
  const component = note("component", "approved", "# Auth module\n\nCode owner for login.", "paths: ['src/auth/**', docs/auth.md]\n");

  it("finds notes by tracked_by and by component paths, then what they impact", async () => {
    const { s, send, mock } = await track(setup({ files: { "tech/auth-module.md": component } }));
    await s.call("POST", `/api/v1/notes/${encodeURIComponent("produit/password-reset")}/links`, { body: { to: "gh:acme/app#20", type: "tracked_by" } });
    mock.state.files["acme/app#20"] = ["src/auth/login.ts", "src/billing/x.ts"];
    await send("pull_request", { action: "opened", repository: { full_name: "acme/app" }, pull_request: prPayload(20) });
    // sessions depends on nothing; make auth-login depend on the component so it is impacted
    await s.call("POST", `/api/v1/notes/${encodeURIComponent("produit/auth-login")}/links`, { body: { to: "tech/auth-module", type: "depends_on" } });

    const r = (await s.call("GET", `/api/v1/graph/impact?pr=${encodeURIComponent("acme/app#20")}`)).body;
    expect(r).toMatchObject({ pr: "acme/app#20", state: "open", files: 2 });
    expect(r.seeds).toEqual(expect.arrayContaining([{ id: "produit/password-reset", reason: "tracked_by" }, { id: "tech/auth-module", reason: "paths: src/auth/**" }]));
    expect(r.impacted.map((n: { id: string }) => n.id)).toContain("produit/auth-login");
    expect((await s.call("GET", `/api/v1/graph/impact?pr=${encodeURIComponent("acme/app#404")}`)).status).toBe(404);
  });

  it("comments on the PR once, then updates the same comment", async () => {
    const { s, send, mock } = await track(setup({ config: "pr_comments: true\n", files: { "tech/auth-module.md": component } }));
    mock.state.files["acme/app#21"] = ["src/auth/a.ts"];
    const open = { action: "opened", repository: { full_name: "acme/app" }, pull_request: prPayload(21) };
    await send("pull_request", open);
    expect(mock.state.comments).toHaveLength(1);
    expect(mock.state.comments[0]?.body).toContain("<!-- defluance-impact -->");
    expect(mock.state.comments[0]?.body).toContain("[tech/auth-module](http://localhost:4000/n/tech/auth-module) (paths: src/auth/**)");
    mock.state.files["acme/app#21"] = ["src/auth/a.ts", "docs/auth.md"];
    await send("pull_request", { ...open, action: "synchronize" });
    expect(mock.state.comments).toHaveLength(1);
    expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true);
    expect(s).toBeTruthy();
  });

  it("globs: ** across folders, * inside one, prefix without wildcard", async () => {
    const { globMatch } = await import("../services/index.js");
    expect(globMatch("src/auth/**", "src/auth/a/b.ts")).toBe(true);
    expect(globMatch("src/*.ts", "src/a.ts")).toBe(true);
    expect(globMatch("src/*.ts", "src/a/b.ts")).toBe(false);
    expect(globMatch("src/auth", "src/auth/x.ts")).toBe(true);
    expect(globMatch("src/auth", "src/authz/x.ts")).toBe(false);
    expect(globMatch("**/*.md", "docs/a/b.md")).toBe(true);
    expect(globMatch("a?c.ts", "abc.ts")).toBe(true);
  });
});

describe("opening issues from a note", () => {
  it("creates the issue, links it back as tracked_by, caches it and audits", async () => {
    const { s, mock } = await track(setup());
    const r = await s.call("POST", `/api/v1/notes/${encodeURIComponent("produit/password-reset")}/issues`, { body: { labels: ["spec"] } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ key: "acme/app#77", number: 77, url: "https://github.com/acme/app/issues/77" });
    const create = mock.calls.find((c) => c.method === "POST" && c.path === "/repos/acme/app/issues");
    expect(create?.body).toMatchObject({ title: "Password reset", labels: ["spec"] });
    expect(create?.body.body).toContain("A reset link is valid for one hour.");
    expect(create?.body.body).toContain("Spec: http://localhost:4000/n/produit/password-reset");

    const links = (await s.call("GET", `/api/v1/notes/${encodeURIComponent("produit/password-reset")}/links`)).body;
    expect(links.outgoing["tracked_by"][0]).toMatchObject({ target: "gh:acme/app#77", github: { state: "open", url: "https://github.com/acme/app/issues/77" } });
    expect((await s.call("GET", "/api/v1/audit?action=issue.create")).body[0]).toMatchObject({ target: "produit/password-reset", payload: { key: "acme/app#77" } });
  });

  it("uses the space's repo, falls back to the default, and refuses other repos", async () => {
    const { s, mock } = await track(setup());
    await s.call("POST", `/api/v1/notes/${encodeURIComponent("tech/sessions")}/issues`, { body: {} });
    expect(mock.calls.some((c) => c.path === "/repos/acme/default/issues")).toBe(true);
    const other = await s.call("POST", `/api/v1/notes/${encodeURIComponent("produit/auth-login")}/issues`, { body: { repo: "evil/repo" } });
    expect(other.status).toBe(422);
  });

  it("needs the issues scope, and an agent's link goes to a branch", async () => {
    const { s } = await track(setup());
    const reader = await s.token(["read", "write"], ["produit"]);
    expect((await s.call("POST", `/api/v1/notes/${encodeURIComponent("produit/auth-login")}/issues`, { token: reader, body: {} })).status).toBe(403);
    const agent = await s.token(["read", "write", "issues"], ["produit"], "claude");
    const r = await s.call("POST", `/api/v1/notes/${encodeURIComponent("produit/auth-login")}/issues`, { token: agent, body: {} });
    expect(r.status).toBe(201);
    expect(r.body.link.branch).toBe("defluance/claude/produit-auth-login");
  });
});

describe("resync", () => {
  it("reads issues and pulls changed since the last sync", async () => {
    const { s, mock } = await track(setup());
    mock.state.issues["acme/app"] = [
      { ...issuePayload(1), html_url: "https://github.com/acme/app/issues/1" },
      { ...issuePayload(2), pull_request: { url: "x" }, html_url: "https://github.com/acme/app/pull/2" },
    ];
    mock.state.pulls["acme/app#2"] = prPayload(2, { state: "closed", merged: true, merged_at: "2026-10-01T00:00:00Z" });
    mock.state.files["acme/app#2"] = ["src/a.ts"];
    const r = await s.call("POST", "/api/v1/github/resync");
    expect(r.body).toEqual({ issues: 1, pulls: 1 });
    expect((await s.call("GET", "/api/v1/github/nodes/acme/app/1")).body).toMatchObject({ kind: "issue", state: "open" });
    expect((await s.call("GET", "/api/v1/github/nodes/acme/app/2")).body).toMatchObject({ kind: "pull-request", state: "merged", files: ["src/a.ts"] });

    mock.calls.length = 0;
    await s.call("POST", "/api/v1/github/resync");
    expect(mock.calls.find((c) => c.path.includes("/issues?"))?.path).toContain("since=");
    const reader = await s.token(["read"], []);
    expect((await s.call("POST", "/api/v1/github/resync", { token: reader })).status).toBe(403);
  });

  it("lists installed repositories for the setup page", async () => {
    const { s } = await track(setup());
    const r = await s.call("GET", "/api/v1/github/status");
    expect(r.body).toMatchObject({ configured: true, repos: ["acme/app", "acme/default"] });
  });
});

describe("vault hosted on GitHub", () => {
  async function withRemote() {
    const dir = await mkdtemp(join(tmpdir(), "dfl-remote-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const bare = join(dir, "vault.git");
    const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.name=ext", "-c", "user.email=e@e", ...a], { encoding: "utf8" });
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
    const env = await track(setup({ config: "vault_repo: acme/vault\nvault_push: true\n" }));
    env.s.git("remote", "add", "origin", bare);
    env.s.git("push", "-q", "-u", "origin", "main");
    return { ...env, bare, dir, g };
  }

  it("a push to the vault repo makes the server pull and re-index", async () => {
    const { s, send, bare, dir, g } = await withRemote();
    const other = join(dir, "other");
    execFileSync("git", ["clone", "-q", bare, other]);
    await writeFile(join(other, "produit", "from-teammate.md"), note("note", "draft", "# From teammate\n\nWritten on someone else's machine."));
    g(other, "add", "-A");
    g(other, "commit", "-q", "-m", "teammate note");
    g(other, "push", "-q", "origin", "main");
    expect((await s.call("GET", "/api/v1/search?q=someone+else")).body).toEqual([]);
    expect((await send("push", { ref: "refs/heads/main", repository: { full_name: "acme/vault" } })).status).toBe(202);
    const hits = (await s.call("GET", "/api/v1/search?q=someone+else")).body as { note: { id: string } }[];
    expect(hits[0]?.note.id).toBe("produit/from-teammate");
    // a push to another repository is ignored
    await send("push", { ref: "refs/heads/main", repository: { full_name: "acme/other" } });
  });

  it("vault_push sends the server's commits to origin", async () => {
    const { s, bare } = await withRemote();
    const r = await s.call("POST", "/api/v1/notes", { body: { type: "note", title: "Pushed", id: "produit/pushed" } });
    expect(r.status).toBe(201);
    expect(execFileSync("git", ["--git-dir", bare, "log", "-1", "--format=%s", "main"], { encoding: "utf8" })).toBe("add produit/pushed\n");
  });
});
