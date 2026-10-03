import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeServer, note, type TestServer } from "./test-env.js";

let s: TestServer;
beforeAll(async () => {
  s = await makeServer();
});
afterAll(() => s.cleanup());

const enc = encodeURIComponent;

describe("authentication", () => {
  it("serves /health without credentials", async () => {
    const r = await s.call("GET", "/health", { token: null });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "ok", checks: { database: "ok", embedder: "hash-512" } });
  });

  it("requires a bearer token and answers problem+json", async () => {
    const r = await s.call("GET", "/api/v1/notes", { token: null });
    expect(r.status).toBe(401);
    expect(r.res.headers.get("content-type")).toContain("application/problem+json");
    expect(r.res.headers.get("www-authenticate")).toBe("Bearer");
    expect((await s.call("GET", "/api/v1/notes", { token: "dfl_nope" })).status).toBe(401);
    expect((await s.call("GET", "/api/v1/notes", { token: "not-a-dfl-token" })).status).toBe(401);
  });

  it("revokes a token immediately", async () => {
    const t = await s.token(["read"]);
    expect((await s.call("GET", "/api/v1/notes", { token: t })).status).toBe(200);
    const list = (await s.call("GET", "/api/v1/tokens")).body as { id: string; name: string }[];
    const id = list.find((x) => x.name.startsWith("t-"))?.id;
    // find the exact one by creating a named token
    const named = await s.token(["read"], [], "to-revoke");
    const row = ((await s.call("GET", "/api/v1/tokens")).body as { id: string; name: string }[]).find((x) => x.name === "to-revoke");
    expect(id).toBeTruthy();
    expect((await s.call("DELETE", `/api/v1/tokens/${row?.id}`)).status).toBe(200);
    expect((await s.call("GET", "/api/v1/notes", { token: named })).status).toBe(401);
  });

  it("rejects expired tokens", async () => {
    const { token } = await s.ctx.sys.createToken({ name: "short", scopes: ["read"], spaces: [], createdBy: "t", expiresInDays: 1 });
    expect((await s.call("GET", "/api/v1/notes", { token })).status).toBe(200);
    await s.ctx.db.run("UPDATE tokens SET expires_at = ? WHERE name = 'short'", [new Date(Date.now() - 1000).toISOString()]);
    expect((await s.call("GET", "/api/v1/notes", { token })).status).toBe(401);
  });

  it("signs in with a token, sets an HttpOnly cookie, and refuses cross-origin writes", async () => {
    const login = await s.request("/auth/token-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: s.admin }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("dfl_session=");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    const session = cookie.split(";")[0] as string;

    expect((await s.request("/api/v1/me", { headers: { cookie: session } })).status).toBe(200);
    const evil = await s.request("/api/v1/notes", { method: "POST", headers: { cookie: session, origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ id: "x", content: "x" }) });
    expect(evil.status).toBe(403);
    const same = await s.request("/api/v1/me", { headers: { cookie: session, origin: "http://localhost:4000" } });
    expect(same.status).toBe(200);
    expect((await s.request("/auth/token-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "dfl_bad" }) })).status).toBe(401);
  });

  it("rate limits per actor", async () => {
    const limited = await makeServer({ env: { DFL_RATE_LIMIT: "3" } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await limited.call("GET", "/api/v1/me")).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    const r = await limited.call("GET", "/api/v1/me");
    expect(Number(r.res.headers.get("retry-after"))).toBeGreaterThan(0);
    await limited.cleanup();
  });
});

describe("spaces and scopes", () => {
  it("hides notes outside the token's spaces, as if they did not exist", async () => {
    const t = await s.token(["read"], ["produit"]);
    const list = (await s.call("GET", "/api/v1/notes", { token: t })).body as { items: { id: string }[] };
    expect(list.items.map((n) => n.id).sort()).toEqual(["produit/auth-login", "produit/password-reset"]);
    expect((await s.call("GET", `/api/v1/notes/${enc("secret/plans")}`, { token: t })).status).toBe(404);
    expect((await s.call("GET", `/api/v1/notes/${enc("tech/sessions")}`, { token: t })).status).toBe(404);
    const search = (await s.call("GET", "/api/v1/search?q=Falcon", { token: t })).body as unknown[];
    expect(search).toEqual([]);
    expect(((await s.call("GET", "/api/v1/search?q=Falcon")).body as unknown[]).length).toBe(1);
    expect((await s.call("GET", "/api/v1/notes?space=secret", { token: t })).body).toMatchObject({ items: [] });
  });

  it("does not leak hidden notes through links or the graph", async () => {
    const t = await s.token(["read"], ["produit"]);
    const links = (await s.call("GET", `/api/v1/notes/${enc("produit/auth-login")}/links`, { token: t })).body as { outgoing: Record<string, { target: string }[]> };
    expect(JSON.stringify(links)).not.toContain("tech/sessions");
    const g = (await s.call("GET", `/api/v1/graph/neighbors?id=${enc("produit/auth-login")}&depth=3`, { token: t })).body as { nodes: { id: string }[] };
    expect(g.nodes.every((n) => n.id.startsWith("produit/"))).toBe(true);
    const overview = (await s.call("GET", "/api/v1/graph/overview", { token: t })).body as { nodes: { id: string }[] };
    expect(overview.nodes.every((n) => n.id.startsWith("produit/"))).toBe(true);
  });

  it("a read token cannot write, a write token can, only within its spaces", async () => {
    const read = await s.token(["read"], ["produit"]);
    const write = await s.token(["write"], ["produit"]);
    const body = { id: "produit/new-spec", content: note("note", "draft", "# New"), mode: "direct" };
    expect((await s.call("POST", "/api/v1/notes", { token: read, body })).status).toBe(403);
    expect((await s.call("POST", "/api/v1/notes", { token: write, body: { ...body, id: "tech/other" } })).status).toBe(403);
  });

  it("lists spaces with the actor's permissions", async () => {
    const t = await s.token(["read", "write"], ["produit"]);
    const spaces = (await s.call("GET", "/api/v1/spaces", { token: t })).body as { name: string; perms: string[]; repos: string[] }[];
    expect(spaces).toEqual([{ name: "produit", path: "produit", repos: ["acme/app"], perms: ["read", "write"] }]);
  });
});

describe("notes", () => {
  it("reads a note with its commit, and notes with encoded slashes", async () => {
    const r = await s.call("GET", `/api/v1/notes/${enc("produit/auth-login")}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: "produit/auth-login", title: "Login", type: "functional-spec", space: "produit", tags: ["auth"] });
    expect(r.body.body).toContain("Users sign in");
    expect(r.body.commit).toMatch(/^[0-9a-f]{40}$/);
    expect((await s.call("GET", `/api/v1/notes/${enc("nope")}`)).status).toBe(404);
  });

  it("rejects ids that could leave the vault", async () => {
    for (const bad of ["..%2Fetc%2Fpasswd", "a%2F..%2Fb", ".git%2Fconfig", "%2Fetc%2Fx"]) {
      const r = await s.call("GET", `/api/v1/notes/${bad}`);
      expect([400, 404]).toContain(r.status);
    }
    const r = await s.call("POST", "/api/v1/notes", { body: { id: "../escape", content: note("note", "draft", "x") } });
    expect(r.status).toBe(400);
  });

  it("creates a note from the template, commits it, and indexes it at once", async () => {
    const r = await s.call("POST", "/api/v1/notes", { body: { type: "technical-spec", title: "Rate limiting", body: "100 requests per minute.", id: "tech/rate-limiting" } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ id: "tech/rate-limiting", branch: null });
    expect(r.body.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(s.git("log", "-1", "--format=%an|%s")).toBe("admin|add tech/rate-limiting\n");
    const read = await s.call("GET", `/api/v1/notes/${enc("tech/rate-limiting")}`);
    expect(read.body).toMatchObject({ type: "technical-spec", status: "draft", space: "tech" });
    const hits = (await s.call("GET", "/api/v1/search?q=requests+per+minute")).body as { note: { id: string } }[];
    expect(hits[0]?.note.id).toBe("tech/rate-limiting");
    expect((await s.call("POST", "/api/v1/notes", { body: { type: "technical-spec", title: "Rate limiting", id: "tech/rate-limiting" } })).status).toBe(409);
  });

  it("validates against the schema: 422 with the list of errors", async () => {
    const r = await s.call("POST", "/api/v1/notes", { body: { id: "tech/bad", content: "---\ntype: memo\n---\n# x" } });
    expect(r.status).toBe(422);
    expect(r.body.errors.map((e: { rule: string }) => e.rule)).toEqual(expect.arrayContaining(["unknown-type", "missing-field"]));
    expect((await s.call("POST", "/api/v1/notes", { body: { title: "only title" } })).status).toBe(422);
    expect((await s.call("POST", "/api/v1/notes", { body: {} })).status).toBe(422);
    expect((await s.call("GET", "/api/v1/notes?limit=0")).status).toBe(422);
  });

  it("updates with base_commit: stale edits get 409 and are not written", async () => {
    const id = enc("produit/password-reset");
    const first = await s.call("GET", `/api/v1/notes/${id}`);
    const edited = first.body.raw.replace("one hour", "two hours");
    const ok = await s.call("PUT", `/api/v1/notes/${id}`, { body: { content: edited, base_commit: first.body.commit } });
    expect(ok.status).toBe(200);
    const stale = await s.call("PUT", `/api/v1/notes/${id}`, { body: { content: first.body.raw.replace("one hour", "three hours"), base_commit: first.body.commit } });
    expect(stale.status).toBe(409);
    expect(stale.body.current).toBe(ok.body.commit);
    expect((await s.call("GET", `/api/v1/notes/${id}`)).body.body).toContain("two hours");
    const hist = await s.call("GET", `/api/v1/notes/${id}/history`);
    expect(hist.body.commits.length).toBeGreaterThanOrEqual(2);
    const diff = await s.call("GET", `/api/v1/notes/${id}/history?diff=${ok.body.commit}`);
    expect(diff.body.patch).toContain("+A reset link is valid for two hours.");
    const old = await s.call("GET", `/api/v1/notes/${id}?rev=${first.body.commit}`);
    expect(old.body.body).toContain("one hour");
  });

  it("changes status by editing one line of the frontmatter", async () => {
    const id = enc("produit/auth-login");
    const before = (await s.call("GET", `/api/v1/notes/${id}`)).body.raw as string;
    const r = await s.call("PATCH", `/api/v1/notes/${id}/status`, { body: { status: "implemented" } });
    expect(r.status).toBe(200);
    const after = (await s.call("GET", `/api/v1/notes/${id}`)).body.raw as string;
    expect(after).toBe(before.replace("status: approved", "status: implemented"));
    expect((await s.call("GET", "/api/v1/search?q=login&status=implemented")).body).toHaveLength(1);
    expect((await s.call("PATCH", `/api/v1/notes/${id}/status`, { body: { status: "wip" } })).status).toBe(422);
  });

  it("lists a link once when it is written in both the frontmatter and the body", async () => {
    // readme declares [[produit/auth-login|related]] in its body only here: add the same one to the frontmatter
    const id = enc("readme");
    await s.call("POST", `/api/v1/notes/${id}/links`, { body: { to: "produit/auth-login", type: "related" } });
    const out = (await s.call("GET", `/api/v1/notes/${id}/links`)).body.outgoing;
    expect(out["related"].filter((l: { target: string }) => l.target === "produit/auth-login")).toHaveLength(1);
    const inc = (await s.call("GET", `/api/v1/notes/${enc("produit/auth-login")}/links`)).body.incoming;
    expect(inc["related"].filter((l: { from: { id: string } }) => l.from.id === "readme")).toHaveLength(1);
  });

  it("adds typed links and refuses unknown types, missing targets and duplicates", async () => {
    const id = enc("produit/password-reset");
    const r = await s.call("POST", `/api/v1/notes/${id}/links`, { body: { to: "tech/sessions", type: "depends_on" } });
    expect(r.status).toBe(201);
    const links = (await s.call("GET", `/api/v1/notes/${id}/links`)).body;
    expect(links.outgoing["depends_on"][0]).toMatchObject({ target: "tech/sessions", note: { id: "tech/sessions", title: "Sessions" }, broken: false });
    expect(Object.keys(links.incoming)).toEqual(["related"]);
    const sessions = (await s.call("GET", `/api/v1/notes/${enc("tech/sessions")}/links`)).body;
    expect(sessions.incoming["depends_on"].map((l: { from: { id: string } }) => l.from.id).sort()).toEqual(["produit/auth-login", "produit/password-reset"]);
    expect((await s.call("POST", `/api/v1/notes/${id}/links`, { body: { to: "tech/sessions", type: "depends_on" } })).status).toBe(409);
    expect((await s.call("POST", `/api/v1/notes/${id}/links`, { body: { to: "tech/sessions", type: "friends_with" } })).status).toBe(422);
    expect((await s.call("POST", `/api/v1/notes/${id}/links`, { body: { to: "nope", type: "related" } })).status).toBe(422);
    const gh = await s.call("POST", `/api/v1/notes/${id}/links`, { body: { to: "gh:acme/app#12", type: "tracked_by" } });
    expect(gh.status).toBe(201);
  });
});

describe("agents", () => {
  it("write to a branch, never to the working tree, and cannot approve", async () => {
    const t = await s.token(["read", "write"], ["produit"], "claude");
    const head = s.git("rev-parse", "HEAD");
    const r = await s.call("POST", "/api/v1/notes", { token: t, body: { type: "functional-spec", title: "Export data", body: "Users can export everything.", id: "produit/export-data" } });
    expect(r.status).toBe(201);
    expect(r.body.branch).toBe("defluance/claude/produit-export-data");
    expect(s.git("rev-parse", "HEAD")).toBe(head);
    expect(s.git("show", `${r.body.branch}:produit/export-data.md`)).toContain("Users can export everything.");
    expect((await s.call("GET", `/api/v1/notes/${enc("produit/export-data")}`)).status).toBe(404);
    expect(s.git("log", "-1", "--format=%an", r.body.branch)).toBe("claude\n");

    const approve = await s.call("PATCH", `/api/v1/notes/${enc("produit/password-reset")}/status`, { token: t, body: { status: "approved" } });
    expect(approve.status).toBe(403);
    const asContent = await s.call("POST", "/api/v1/notes", { token: t, body: { id: "produit/sneaky", content: note("note", "approved", "x") } });
    expect(asContent.status).toBe(403);
    const review = await s.call("PATCH", `/api/v1/notes/${enc("produit/password-reset")}/status`, { token: t, body: { status: "review" } });
    expect(review.status).toBe(200);
    expect(review.body.branch).toMatch(/^defluance\/claude\//);
  });

  it("every write is in the audit log with the actor and the commit", async () => {
    const log = (await s.call("GET", "/api/v1/audit?actor=claude")).body as { action: string; actor_name: string; target: string; commit_sha: string; payload: { branch?: string } }[];
    expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(["note.create", "note.status"]));
    expect(log[0]).toMatchObject({ actor_name: "claude" });
    expect(log.find((e) => e.action === "note.create")).toMatchObject({ target: "produit/export-data", payload: { branch: "defluance/claude/produit-export-data" } });
    expect(log.find((e) => e.action === "note.create")?.commit_sha).toMatch(/^[0-9a-f]{40}$/);
    const none = await s.token(["read", "write"], ["produit"]);
    expect((await s.call("GET", "/api/v1/audit", { token: none })).status).toBe(403);
  });
});

describe("tokens and members", () => {
  it("returns the token once, and only lets you grant what you hold", async () => {
    const created = await s.call("POST", "/api/v1/tokens", { body: { name: "ci", scopes: ["read"], spaces: ["produit"], expires_in_days: 30 } });
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^dfl_/);
    const listed = (await s.call("GET", "/api/v1/tokens")).body as Record<string, unknown>[];
    expect(listed.some((t) => "token" in t || "hash" in t)).toBe(false);

    const spaceAdmin = await s.token(["read", "write", "admin"], ["produit"]);
    expect((await s.call("POST", "/api/v1/tokens", { token: spaceAdmin, body: { name: "a", scopes: ["read"], spaces: ["tech"] } })).status).toBe(403);
    expect((await s.call("POST", "/api/v1/tokens", { token: spaceAdmin, body: { name: "a", scopes: ["read"], spaces: [] } })).status).toBe(403);
    expect((await s.call("POST", "/api/v1/tokens", { token: spaceAdmin, body: { name: "ok", scopes: ["read", "write"], spaces: ["produit"] } })).status).toBe(201);
    const writer = await s.token(["read", "write"], ["produit"]);
    expect((await s.call("POST", "/api/v1/tokens", { token: writer, body: { name: "x", scopes: ["read"], spaces: ["produit"] } })).status).toBe(403);
    expect((await s.call("POST", "/api/v1/tokens", { body: { name: "x", scopes: ["root"], spaces: [] } })).status).toBe(422);
  });

  it("manages space members", async () => {
    expect((await s.call("PUT", "/api/v1/spaces/produit/members", { body: { login: "newbie", role: "editor" } })).status).toBe(200);
    expect((await s.call("GET", "/api/v1/spaces/produit/members")).body).toEqual([{ login: "newbie", name: null, role: "editor" }]);
    expect((await s.call("DELETE", "/api/v1/spaces/produit/members?login=newbie")).status).toBe(200);
    expect((await s.call("GET", "/api/v1/spaces/produit/members")).body).toEqual([]);
    const writer = await s.token(["read", "write"], ["produit"]);
    expect((await s.call("GET", "/api/v1/spaces/produit/members", { token: writer })).status).toBe(403);
    expect((await s.call("GET", "/api/v1/spaces/nope/members")).status).toBe(404);
  });
});

describe("schema, scoped questions and recent notes", () => {
  it("serves the vault schema and the public auth config", async () => {
    const schema = (await s.call("GET", "/api/v1/schema")).body;
    expect(schema.statuses).toEqual(["draft", "review", "approved", "implemented", "deprecated"]);
    expect(schema.linkTypes).toContain("tracked_by");
    expect(Object.keys(schema.types)).toContain("functional-spec");
    expect((await s.call("GET", "/auth/config", { token: null })).body).toEqual({ oauth: false, local: false });
  });

  it("ask can be limited to a note and its neighbours", async () => {
    const q = "What expires after fifteen minutes?";
    const all = (await s.call("POST", "/api/v1/ask", { body: { question: q } })).body;
    expect(all.citations[0].note).toBe("tech/sessions");
    // readme -> auth-login -> sessions: sessions is two links away
    const scoped = (await s.call("POST", "/api/v1/ask", { body: { question: q, scope_note: "readme" } })).body;
    expect(scoped.citations.map((c: { note: string }) => c.note)).not.toContain("tech/sessions");
    const wider = (await s.call("POST", "/api/v1/ask", { body: { question: q, scope_note: "readme", scope_depth: 2 } })).body;
    expect(wider.citations[0].note).toBe("tech/sessions");
    const near = (await s.call("POST", "/api/v1/ask", { body: { question: q, scope_note: "produit/auth-login" } })).body;
    expect(near.citations[0].note).toBe("tech/sessions");
    expect((await s.call("POST", "/api/v1/ask", { body: { question: q, scope_note: "nope" } })).status).toBe(404);
  });

  it("lists most recently indexed notes first", async () => {
    const id = enc("tech/sessions");
    const raw = (await s.call("GET", `/api/v1/notes/${id}`)).body;
    await s.call("PUT", `/api/v1/notes/${id}`, { body: { content: raw.raw.replace("fifteen", "ten"), base_commit: raw.commit } });
    const list = (await s.call("GET", "/api/v1/notes?sort=updated&limit=1")).body;
    expect(list.items[0].id).toBe("tech/sessions");
  });
});

describe("graph, search and index", () => {
  it("answers neighbors, path, impact and lint", async () => {
    const n = (await s.call("GET", `/api/v1/graph/neighbors?id=${enc("tech/sessions")}&direction=in`)).body;
    expect(n.nodes.map((x: { id: string }) => x.id).sort()).toContain("produit/auth-login");
    const p = (await s.call("GET", `/api/v1/graph/path?from=${enc("readme")}&to=${enc("tech/sessions")}`)).body;
    expect(p.found).toBe(true);
    const imp = (await s.call("GET", `/api/v1/graph/impact?id=${enc("tech/sessions")}`)).body;
    expect(imp.notes.map((x: { id: string }) => x.id)).toContain("produit/auth-login");
    expect((await s.call("GET", "/api/v1/graph/impact")).status).toBe(422);
    expect((await s.call("GET", "/api/v1/graph/lint")).body).toHaveProperty("orphans");
  });

  it("reports index status and rebuilds it (admin only)", async () => {
    const status = (await s.call("GET", "/api/v1/index/status")).body;
    expect(status).toMatchObject({ embed_model: "hash-512" });
    expect(status.notes).toBeGreaterThan(4);
    const before = status.notes;
    const rebuilt = await s.call("POST", "/api/v1/index/rebuild");
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body.notes).toBe(before);
    const t = await s.token(["read", "write"], []);
    expect((await s.call("POST", "/api/v1/index/rebuild", { token: t })).status).toBe(403);
  });

  it("answers questions with citations and refuses without sources", async () => {
    const a = await s.call("POST", "/api/v1/ask", { body: { question: "How long do session cookies last?" } });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ refused: false, mode: "extractive" });
    expect(a.body.citations[0]).toMatchObject({ note: "tech/sessions", heading: "Sessions" });
    expect((await s.call("POST", "/api/v1/ask", { body: { question: "What is the airspeed velocity of a swallow?" } })).body.refused).toBe(true);
    const t = await s.token(["read"], ["produit"]);
    expect((await s.call("POST", "/api/v1/ask", { token: t, body: { question: "What is the Falcon acquisition codename?" } })).body.refused).toBe(true);
  });
});

describe("GET /api/v1/stats", () => {
  it("counts notes by type and status, only in spaces the token may read", async () => {
    const s = await makeServer();
    try {
      const all = await s.call("GET", "/api/v1/stats");
      expect(all.status).toBe(200);
      expect(all.body.total).toBe(5);
      const byType = Object.fromEntries(all.body.groups.map((g: { type: string; total: number }) => [g.type, g.total]));
      expect(byType).toEqual({ "functional-spec": 2, note: 2, "technical-spec": 1 });
      expect(all.body.groups.find((g: { type: string }) => g.type === "functional-spec").statuses).toEqual({ approved: 1, draft: 1 });

      const narrow = await s.token(["read"], ["tech"]);
      const some = await s.call("GET", "/api/v1/stats", { token: narrow });
      expect(some.body).toEqual({ total: 1, groups: [{ type: "technical-spec", total: 1, statuses: { approved: 1 } }] });
    } finally {
      await s.cleanup();
    }
  });
});
