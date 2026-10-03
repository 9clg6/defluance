import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GhNode } from "@defluance/indexer";
import { afterEach, describe, expect, it } from "vitest";
import { FILES, makeServer, type TestServer } from "../test-env.js";
import { GithubClient } from "./client.js";
import { MockGithub } from "./mock.js";
import { GithubService } from "./service.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const CONFIG = "# vault settings\nspaces:\n  - { name: produit, path: produit, repos: [acme/app] }   # product\n  - { name: tech, path: tech }\nrepos: [acme/default]\n# keep me\n";
const REPO = "linagora/twake-on-matrix";

const at = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString();
const issue = (n: number, extra: Record<string, unknown> = {}) => ({ number: n, title: `Issue ${n}`, state: "open", labels: [{ name: "bug" }], user: { login: "ana" }, html_url: `https://github.com/${REPO}/issues/${n}`, updated_at: at(n), ...extra });
const pr = (n: number, extra: Record<string, unknown> = {}) => ({ number: n, title: `PR ${n}`, state: "open", merged_at: null, labels: [], user: { login: "karim" }, html_url: `https://github.com/${REPO}/pull/${n}`, updated_at: at(n), head: { ref: "fix" }, ...extra });
/** `count` rows, newest first, numbered from `count` down to 1. */
const many = (count: number, make: (n: number) => Record<string, unknown>) => Array.from({ length: count }, (_, i) => make(count - i));

/** GitHub's REST API as far as this feature uses it: public repositories without credentials, plus the App endpoints. */
function fakeGithub() {
  const st = {
    repos: { [REPO]: { full_name: REPO, private: false } } as Record<string, { full_name: string; private: boolean }>,
    issues: {} as Record<string, Record<string, unknown>[]>,
    pulls: {} as Record<string, Record<string, unknown>[]>,
    installed: [] as string[],
    remaining: 60,
    /** Answer 403 once this many public requests were made. */
    blockAfter: Infinity,
    publicCalls: 0,
  };
  const calls: { path: string; auth: string | null }[] = [];
  const reply = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
  const fetchFake = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const auth = (init?.headers as Record<string, string> | undefined)?.["authorization"] ?? null;
    calls.push({ path: u.pathname + u.search, auth });
    const p = u.pathname;
    if (p === "/app/installations") return reply([{ id: 1 }]);
    if (p === "/app/installations/1/access_tokens") return reply({ token: "ghs_inst", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (p === "/installation/repositories") return reply({ repositories: st.installed.map((full_name) => ({ full_name })) });
    if (/\/installation$/.test(p)) return reply({ id: 1 });
    const m = /^\/repos\/([^/]+\/[^/]+)(?:\/(issues|pulls))?$/.exec(p);
    if (!m || auth) return reply({ message: "not found" }, 404);
    const reset = String(Math.floor(Date.now() / 1000) + 3600);
    if (++st.publicCalls > st.blockAfter) return reply({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset });
    const headers = { "x-ratelimit-remaining": String(--st.remaining), "x-ratelimit-reset": reset };
    const key = (m[1] as string).toLowerCase();
    if (!m[2]) {
      const r = st.repos[key];
      return r ? reply(r, 200, headers) : reply({ message: "Not Found" }, 404, headers);
    }
    const since = u.searchParams.get("since");
    const all = (m[2] === "issues" ? st.issues : st.pulls)[key] ?? [];
    const rows = (since && m[2] === "issues" ? all.filter((r) => String(r["updated_at"]) >= since) : all).slice((Number(u.searchParams.get("page") ?? 1) - 1) * 100).slice(0, 100);
    return reply(rows, 200, headers);
  }) as typeof fetch;
  const publicPaths = (kind: "issues" | "pulls") => calls.filter((c) => c.path.startsWith(`/repos/${REPO}/${kind}`)).map((c) => c.path);
  const publicCalls = () => calls.filter((c) => c.path.startsWith("/repos/")).length;
  return { st, calls, fetch: fetchFake, publicPaths, publicCalls };
}

const count = async (s: TestServer) => Number((await s.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM gh_nodes"))?.c);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function setup(init: (st: ReturnType<typeof fakeGithub>["st"]) => void = () => {}, config = CONFIG) {
  const gh = fakeGithub();
  init(gh.st);
  const s = await makeServer({
    files: { ...FILES, ".defluance/config.yaml": config },
    fetch: gh.fetch,
    github: (ctx) => new GithubService(ctx, new GithubClient({ appId: "123", privateKey, apiUrl: "https://api.github.com", fetch: gh.fetch }), "whsec"),
  });
  cleanups.push(() => s.cleanup());
  const put = (body: unknown, token?: string | null) => s.call("PUT", "/api/v1/github/repos", { body, ...(token !== undefined ? { token } : {}) });
  const items = async (q = "") => ((await s.call("GET", `/api/v1/github/items?limit=100&repo=${REPO}${q}`)).body.items as GhNode[]);
  const status = async () => (await s.call("GET", "/api/v1/github/status")).body;
  const link = async (body: Record<string, unknown> = {}) => {
    const r = await put({ repo: REPO, public: true, linked: true, ...body });
    await s.flush();
    return r;
  };
  return { s, gh, put, items, status, link, cfg: () => readFileSync(join(s.root, ".defluance/config.yaml"), "utf8") };
}

describe("linking a public repository", () => {
  it("validates it without credentials, links it like an installed one, commits, audits and syncs it", async () => {
    const { s, gh, link, items, status, cfg } = await setup((st) => {
      st.issues[REPO] = [issue(2), issue(1)];
    });
    const r = await link({ repo: "Linagora/Twake-On-Matrix", space: "tech" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ repo: REPO, space: "tech", linked: true, public: true, changed: true });
    expect(cfg()).toContain("# keep me");
    expect(cfg()).toContain("# product");
    expect((await s.ctx.getConfig()).spaces.find((x) => x.name === "tech")?.repos).toEqual([REPO]);
    expect(s.git("log", "-1", "--format=%s")).toBe(`github: link ${REPO} (public)\n`);
    expect(JSON.stringify((await s.call("GET", "/api/v1/audit?limit=10")).body)).toContain('"public":true');
    expect((await items()).map((n) => n.key)).toEqual([`${REPO}#2`, `${REPO}#1`]);
    // Nothing of the App's or the user's reaches GitHub for a public repository.
    expect(gh.calls.filter((c) => c.path.startsWith(`/repos/${REPO}`)).every((c) => c.auth === null)).toBe(true);
    const st = await status();
    expect(st.publicRepos).toEqual([REPO]);
    expect(st.publicSync).toEqual([expect.objectContaining({ repo: REPO, partial: false, rateLimitedUntil: null })]);
    expect(st.repos).toEqual([]);
  });

  it("answers 422 for a missing or private repository, 503 with the reset time when rate limited, and changes nothing", async () => {
    const { s, gh, put, cfg } = await setup((st) => {
      st.repos["acme/secret"] = { full_name: "acme/secret", private: true };
    });
    const before = cfg();
    const missing = await put({ repo: "nobody/nothing", public: true, linked: true });
    expect(missing.status).toBe(422);
    expect(JSON.stringify(missing.body)).toContain("repository not found or private");
    const priv = await put({ repo: "acme/secret", public: true, linked: true });
    expect(priv.status).toBe(422);
    expect(JSON.stringify(priv.body)).toContain("only public repositories can be linked without installing the App");
    gh.st.blockAfter = 0;
    const limited = await put({ repo: REPO, public: true, linked: true });
    expect(limited.status).toBe(503);
    expect(JSON.stringify(limited.body)).toMatch(/try again after 20\d\d-/);
    expect(cfg()).toBe(before);
    expect(s.git("log", "-1", "--format=%s")).toBe("init\n");
  });

  it("refuses agents and non-admins, and still needs GitHub configured", async () => {
    const { s, put, gh } = await setup();
    const body = { repo: REPO, public: true, linked: true };
    expect((await put(body, await s.token(["read", "write"]))).status).toBe(403);
    expect((await put(body, await s.token(["read", "write", "admin"], ["produit"]))).status).toBe(403);
    expect(gh.calls).toEqual([]);
    const none = await makeServer({ github: null });
    cleanups.push(() => none.cleanup());
    expect((await none.call("PUT", "/api/v1/github/repos", { body })).status).toBe(503);
  });

  it("prefers the installed path when the App already sees the repository", async () => {
    const { gh, link, status } = await setup((st) => {
      st.installed = [REPO];
      st.issues[REPO] = [issue(1)];
    });
    const r = await link();
    expect(r.body).toMatchObject({ repo: REPO, public: false, changed: true });
    expect(gh.calls.some((c) => c.path.includes("access_tokens"))).toBe(true);
    expect(gh.calls.some((c) => c.path === `/repos/${REPO}` && c.auth === null)).toBe(false);
    expect((await status()).publicRepos).toEqual([]);
  });

  it("shows items only to readers of the space it is linked to, and unlinks", async () => {
    const { s, gh, link, put, status } = await setup((st) => {
      st.issues[REPO] = [issue(1)];
    });
    await link({ space: "produit" });
    const seen = async (token: string) => ((await s.call("GET", `/api/v1/github/items?repo=${REPO}`, { token })).body.items as GhNode[]).length;
    expect(await seen(await s.token(["read"], ["produit"]))).toBe(1);
    expect(await seen(await s.token(["read"], ["tech"]))).toBe(0);
    const gone = await put({ repo: REPO, space: "produit", linked: false });
    expect(gone.body).toMatchObject({ linked: false, changed: true, public: false });
    expect((await status()).publicRepos).toEqual([]);
    const n = gh.publicCalls();
    await s.ctx.github?.refreshPublic?.();
    expect(gh.publicCalls()).toBe(n);
  });
});

describe("syncing a public repository", () => {
  it("maps issues and pull requests: merged, closed and open, without file lists", async () => {
    const { link, items } = await setup((st) => {
      st.issues[REPO] = [issue(9, { pull_request: { url: "x" } }), issue(7, { state: "closed" }), issue(5, { labels: [{ name: "a" }, "b"] })];
      st.pulls[REPO] = [pr(9, { state: "open" }), pr(8, { state: "closed", merged_at: at(8) }), pr(6, { state: "closed" })];
    });
    await link();
    const by = Object.fromEntries((await items()).map((n) => [n.key, n]));
    expect(Object.keys(by).sort()).toEqual([5, 6, 7, 8, 9].map((n) => `${REPO}#${n}`).sort());
    expect(by[`${REPO}#9`]).toMatchObject({ kind: "pull-request", state: "open", author: "karim", files: [] });
    expect(by[`${REPO}#8`]).toMatchObject({ kind: "pull-request", state: "merged", merged_at: at(8), files: [] });
    expect(by[`${REPO}#6`]).toMatchObject({ kind: "pull-request", state: "closed", merged_at: null });
    expect(by[`${REPO}#7`]).toMatchObject({ kind: "issue", state: "closed" });
    expect(by[`${REPO}#5`]).toMatchObject({ kind: "issue", state: "open", labels: ["a", "b"], url: `https://github.com/${REPO}/issues/5`, updated_at: at(5) });
  });

  it("pages through 100 rows at a time", async () => {
    const { s, link, gh } = await setup((st) => {
      st.issues[REPO] = many(250, issue);
    });
    await link();
    expect((await count(s))).toBe(250);
    expect(gh.publicPaths("issues")).toHaveLength(3);
    expect(gh.publicPaths("issues")[0]).toContain("state=all&sort=updated&direction=desc&per_page=100&page=1");
  });

  it("caps the first sync at 300 items per endpoint", async () => {
    const { s, link, status, gh } = await setup((st) => {
      st.issues[REPO] = many(450, issue);
      st.pulls[REPO] = many(450, (n) => pr(1000 + n));
    });
    await link();
    expect(gh.publicPaths("issues")).toHaveLength(3);
    expect(gh.publicPaths("pulls")).toHaveLength(3);
    expect((await count(s))).toBe(600);
    expect((await status()).publicSync[0]).toMatchObject({ partial: false });
  });

  it("reads only what changed since the last complete sync", async () => {
    const { s, link, gh, items } = await setup((st) => {
      st.issues[REPO] = [issue(2), issue(1)];
      st.pulls[REPO] = [pr(4), pr(3)];
    });
    await link();
    const future = new Date(Date.now() + 60_000).toISOString();
    gh.st.issues[REPO] = [issue(5, { updated_at: future }), ...(gh.st.issues[REPO] ?? [])];
    gh.st.pulls[REPO] = [pr(6, { updated_at: future, state: "closed", merged_at: future }), ...(gh.st.pulls[REPO] ?? [])];
    gh.calls.length = 0;
    const r = await s.ctx.github?.resync(REPO);
    expect(r).toMatchObject({ issues: 1, pulls: 1 });
    expect(gh.publicPaths("issues")).toHaveLength(1);
    expect(gh.publicPaths("issues")[0]).toMatch(/since=20\d\d-/);
    expect(gh.publicPaths("pulls")).toHaveLength(1); // stops at the first row older than the cursor
    expect((await items()).find((n) => n.key === `${REPO}#6`)?.state).toBe("merged");
  });

  it("stops before the unauthenticated limit, keeps what it fetched, does not throw, and tries again later", async () => {
    const { s, link, gh, status } = await setup((st) => {
      st.issues[REPO] = many(450, issue);
      st.remaining = 9; // validation leaves 8, the first page 7, the second page 6, the third would leave 5
    });
    const r = await link();
    expect(r.status).toBe(200);
    const state = (await status()).publicSync[0];
    expect(state).toMatchObject({ repo: REPO, partial: true });
    expect(state.rateLimitedUntil).toMatch(/^20\d\d-/);
    expect(gh.publicPaths("issues").length).toBeLessThan(4);
    expect((await count(s))).toBeGreaterThanOrEqual(100);
    // Still inside the window: no request at all.
    const n = gh.publicCalls();
    await s.ctx.github?.refreshPublic?.();
    expect(gh.publicCalls()).toBe(n);
    expect(JSON.stringify((await s.call("GET", "/api/v1/audit?limit=10")).body)).toContain("github.public.sync");
  });

  it("survives a 403 answer in the middle of a sync", async () => {
    const { s, link, status, gh } = await setup((st) => {
      st.issues[REPO] = many(450, issue);
      st.blockAfter = 2; // validation and the first page pass, the second gets a 403
    });
    expect((await link()).status).toBe(200);
    expect((await status()).publicSync[0]).toMatchObject({ partial: true });
    expect((await count(s))).toBe(100);
    expect(gh.publicPaths("pulls")).toHaveLength(0);
    expect(s.logs.some((l) => l.includes("public GitHub sync incomplete"))).toBe(true);
  });
});

describe("periodic refresh", () => {
  it("syncs every linked public repository in turn, and does nothing when there is none", async () => {
    const other = "acme/lib";
    const { s, gh, link, put } = await setup((st) => {
      st.repos[other] = { full_name: other, private: false };
      st.issues[REPO] = [issue(1)];
      st.issues[other] = [{ ...issue(1), html_url: `https://github.com/${other}/issues/1` }];
    });
    const idle = gh.publicCalls();
    await s.ctx.github?.refreshPublic?.();
    expect(gh.publicCalls()).toBe(idle);
    await link();
    expect((await put({ repo: other, public: true, linked: true })).status).toBe(200);
    await s.flush();
    gh.calls.length = 0;
    gh.st.issues[REPO] = [issue(2, { updated_at: new Date(Date.now() + 60_000).toISOString() }), issue(1)];
    await s.ctx.github?.refreshPublic?.();
    const repos = gh.calls.filter((c) => c.path.startsWith("/repos/")).map((c) => c.path.split("/").slice(2, 4).join("/"));
    expect(repos.indexOf(other)).toBeLessThan(repos.indexOf(REPO)); // one repository at a time, in name order
    expect(repos.lastIndexOf(other)).toBeLessThan(repos.indexOf(REPO));
    expect(new Set(repos)).toEqual(new Set([REPO, other]));
    expect((await s.ctx.store.listGhNodes({ repos: [REPO] })).map((n) => n.key).sort()).toEqual([`${REPO}#1`, `${REPO}#2`]);
  });
});

describe("demo connector", () => {
  it("accepts public: true for a repository it knows, and rejects an unknown one", async () => {
    const node = (key: string): GhNode => ({ key, kind: "issue", state: "open", title: "Demo", labels: [], author: "ana", files: [], merged_at: null, url: null, updated_at: "2026-09-15T00:00:00Z" });
    const s: TestServer = await makeServer({ files: { ...FILES, ".defluance/config.yaml": CONFIG }, github: (ctx) => new MockGithub(ctx, [node("acme/web#1")]) });
    cleanups.push(() => s.cleanup());
    const put = (repo: string) => s.call("PUT", "/api/v1/github/repos", { body: { repo, public: true, linked: true } });
    const ok = await put("ACME/web");
    expect(ok.body).toMatchObject({ repo: "acme/web", public: true, changed: true });
    expect((await put("acme/unknown")).status).toBe(422);
    await s.flush();
    expect((await s.call("GET", "/api/v1/github/items?repo=acme/web")).body.items).toHaveLength(1);
    expect((await s.call("GET", "/api/v1/github/status")).body.publicRepos).toEqual(["acme/web"]);
  });
});
