import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Validator } from "@seriousme/openapi-schema-validator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GithubPort } from "./ports.js";
import { makeServer, type TestServer } from "./test-env.js";

describe("OpenAPI document", () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await makeServer();
  });
  afterAll(() => s.cleanup());

  it("is public, valid OpenAPI 3.1, and describes every REST endpoint", async () => {
    const r = await s.call("GET", "/api/v1/openapi.json", { token: null });
    expect(r.status).toBe(200);
    const result = await new Validator().validate(r.body);
    expect(result.errors ?? result.valid).toSatisfy((v: unknown) => v === true || (Array.isArray(v) && v.length === 0));
    expect(r.body.openapi).toBe("3.1.0");
    const paths = Object.keys(r.body.paths);
    for (const p of ["/api/v1/notes", "/api/v1/notes/{id}", "/api/v1/notes/{id}/status", "/api/v1/notes/{id}/links", "/api/v1/notes/{id}/history", "/api/v1/notes/{id}/issues", "/api/v1/search", "/api/v1/graph/neighbors", "/api/v1/graph/path", "/api/v1/graph/impact", "/api/v1/graph/lint", "/api/v1/ask", "/api/v1/index/status", "/api/v1/index/rebuild", "/api/v1/audit", "/api/v1/tokens", "/api/v1/tokens/{id}", "/api/v1/github/resync"]) {
      expect(paths).toContain(p);
    }
    expect(r.body.components.securitySchemes.bearer).toMatchObject({ type: "http", scheme: "bearer" });
  });

  it("answers errors as problem+json, including unknown routes", async () => {
    const r = await s.call("GET", "/api/v1/nope");
    expect(r.status).toBe(404);
    expect(r.res.headers.get("content-type")).toContain("application/problem+json");
    expect(r.body).toMatchObject({ status: 404, title: "not found" });
  });
});

describe("GitHub sign-in", () => {
  const calls: string[] = [];
  const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/login/oauth/access_token")) {
      const body = JSON.parse(String(init?.body)) as { code: string };
      return json(body.code === "good" ? { access_token: "gho_x" } : { error: "bad_verification_code" });
    }
    if (u.endsWith("/user")) return json({ id: 42, login: "octo", name: "Octo Cat", avatar_url: "https://a/b.png" });
    return new Response("nope", { status: 404 });
  }) as typeof fetch;

  const env = { GITHUB_OAUTH_CLIENT_ID: "cid", GITHUB_OAUTH_CLIENT_SECRET: "csecret" };

  const sessionOf = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith("dfl_session="))?.split(";")[0] as string;

  async function login(s: TestServer, code = "good") {
    const start = await s.request("/auth/github/login");
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get("location") as string);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("cid");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:4000/auth/github/callback");
    const stateCookie = (start.headers.get("set-cookie") ?? "").split(";")[0] as string;
    const cb = await s.request(`/auth/github/callback?code=${code}&state=${location.searchParams.get("state")}`, { headers: { cookie: stateCookie } });
    return cb;
  }

  it("is off without credentials", async () => {
    const s = await makeServer();
    expect((await s.request("/auth/github/login")).status).toBe(404);
    await s.cleanup();
  });

  it("signs a user in and gives them no access until an admin grants a role", async () => {
    const s = await makeServer({ env, fetch: fetchMock });
    const cb = await login(s);
    expect(cb.status).toBe(302);
    const session = sessionOf(cb);
    expect(session).toContain("dfl_session=");
    const me = await s.request("/api/v1/me", { headers: { cookie: session } });
    expect(await me.json()).toMatchObject({ kind: "user", name: "octo", spaces: [] });
    expect(((await (await s.request("/api/v1/notes", { headers: { cookie: session } })).json()) as { items: unknown[] }).items).toEqual([]);

    await s.call("PUT", "/api/v1/spaces/produit/members", { body: { login: "octo", role: "editor" } });
    const spaces = (await (await s.request("/api/v1/spaces", { headers: { cookie: session } })).json()) as { name: string; perms: string[] }[];
    expect(spaces).toEqual([expect.objectContaining({ name: "produit", perms: ["read", "write", "issues"] })]);
    const write = await s.request("/api/v1/notes", { method: "POST", headers: { cookie: session, "content-type": "application/json" }, body: JSON.stringify({ type: "note", title: "From octo", id: "produit/from-octo" }) });
    expect(write.status).toBe(201);
    expect((await write.json()).branch).toBeNull(); // a person, not an agent
    expect(s.git("log", "-1", "--format=%an")).toBe("octo\n");
    await s.cleanup();
  });

  it("DFL_ADMINS are admins everywhere, DFL_DEFAULT_ROLE opens read access", async () => {
    const admin = await makeServer({ env: { ...env, DFL_ADMINS: "OCTO" }, fetch: fetchMock });
    const session = sessionOf(await login(admin));
    const me = (await (await admin.request("/api/v1/me", { headers: { cookie: session } })).json()) as { spaces: { perms: string[] }[] };
    expect(me.spaces.every((x) => x.perms.includes("admin"))).toBe(true);
    await admin.cleanup();

    const reader = await makeServer({ env: { ...env, DFL_DEFAULT_ROLE: "reader" }, fetch: fetchMock });
    const rs = sessionOf(await login(reader));
    const list = (await (await reader.request("/api/v1/notes", { headers: { cookie: rs } })).json()) as { items: unknown[] };
    expect(list.items.length).toBeGreaterThan(3);
    expect((await reader.request("/api/v1/notes", { method: "POST", headers: { cookie: rs, "content-type": "application/json" }, body: JSON.stringify({ type: "note", title: "x", id: "x" }) })).status).toBe(403);
    await reader.cleanup();
  });

  it("rejects a forged state and a refused code", async () => {
    const s = await makeServer({ env, fetch: fetchMock });
    expect((await s.request("/auth/github/callback?code=good&state=forged")).status).toBe(400);
    expect((await login(s, "bad")).status).toBe(401);
    await s.cleanup();
  });

  it("logs out by clearing the cookie", async () => {
    const s = await makeServer();
    const r = await s.request("/auth/logout", { method: "POST" });
    expect(r.headers.get("set-cookie")).toContain("dfl_session=;");
    await s.cleanup();
  });
});

describe("GitHub webhook route", () => {
  it("hands the raw body, event and signature to the connector", async () => {
    const seen: unknown[] = [];
    const github: GithubPort = {
      repos: async () => ["acme/app"],
      createIssue: async () => ({ key: "acme/app#1", number: 1, url: "u" }),
      handleWebhook: async (i) => (seen.push(i), { status: 202, message: "queued" }),
      resync: async () => ({ issues: 0, pulls: 0 }),
      comment: async () => undefined,
    };
    const s = await makeServer({ github });
    const body = '{"action":"opened"}';
    const r = await s.request("/webhooks/github", { method: "POST", headers: { "x-github-event": "issues", "x-github-delivery": "d1", "x-hub-signature-256": "sha256=abc" }, body });
    expect(r.status).toBe(202);
    expect(seen).toEqual([{ event: "issues", delivery: "d1", signature: "sha256=abc", body }]);
    const gh = (await s.call("GET", "/api/v1/github/status")).body;
    expect(gh).toMatchObject({ configured: true, repos: ["acme/app"], webhookUrl: "http://localhost:4000/webhooks/github" });
    await s.cleanup();

    const none = await makeServer();
    expect((await none.request("/webhooks/github", { method: "POST", body: "{}" })).status).toBe(503);
    expect((await none.call("GET", "/api/v1/github/status")).body.configured).toBe(false);
    await none.cleanup();
  });
});

describe("static UI", () => {
  let dir: string;
  let s: TestServer;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "dfl-ui-"));
    for (const [p, c] of Object.entries({ "index.html": "home", "n/index.html": "note page", "graph/index.html": "graph page", "_next/static/a.js": "js", "404.html": "missing" })) {
      await mkdir(join(dir, p, ".."), { recursive: true });
      await writeFile(join(dir, p), c);
    }
    s = await makeServer({ uiDir: dir });
  });
  afterAll(async () => {
    await s.cleanup();
    await rm(dir, { recursive: true, force: true });
  });

  it("serves exported pages, and every /n/* path with the note page", async () => {
    expect(await (await s.request("/")).text()).toBe("home");
    expect(await (await s.request("/graph")).text()).toBe("graph page");
    expect(await (await s.request("/n/produit/auth-login")).text()).toBe("note page");
    expect(await (await s.request("/n/a%20b")).text()).toBe("note page");
  });

  it("caches hashed assets forever and pages not at all", async () => {
    const asset = await s.request("/_next/static/a.js");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(asset.headers.get("content-type")).toContain("javascript");
    expect((await s.request("/")).headers.get("cache-control")).toBe("no-cache");
  });

  it("does not leave the UI folder, and answers 404 with the 404 page", async () => {
    const r = await s.request("/..%2F..%2Fetc%2Fpasswd");
    expect(r.status).toBe(404);
    const missing = await s.request("/nowhere");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("missing");
  });

  it("does not shadow the API", async () => {
    expect((await s.request("/api/v1/me")).status).toBe(401);
    expect((await s.request("/health")).status).toBe(200);
  });
});
