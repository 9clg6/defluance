import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { head } from "@defluance/vault-core";
import { actorFromToken, actorFromUser, sign, verify, type Actor } from "./auth.js";
import type { Ctx } from "./context.js";
import { HttpError } from "./errors.js";
import { buildMcpServer } from "./mcp.js";
import { Metrics } from "./metrics.js";
import * as svc from "./services.js";
import { resolveStatic, readStatic } from "./static.js";
import { PERMS, ROLES } from "./system.js";

type AppEnv = { Variables: { actor: Actor; via: "bearer" | "cookie" } };

export const SESSION_COOKIE = "dfl_session";
const SESSION_DAYS = 7;

const Problem = z.object({ type: z.string(), title: z.string(), status: z.number(), detail: z.string().optional() }).openapi("Problem");

function problem(c: Context, status: number, title: string, extra: Record<string, unknown> = {}) {
  return c.body(JSON.stringify({ type: "about:blank", title, status, ...extra }), status as never, { "content-type": "application/problem+json" });
}

const ok = (description: string, schema: z.ZodType = z.any()) => ({ description, content: { "application/json": { schema } } });
const errs = { default: { description: "Error", content: { "application/problem+json": { schema: Problem } } } };
const jsonBody = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } }, required: true as const });

const idParam = z.object({ id: z.string().min(1).openapi({ description: "Note id (path without .md), URL-encoded: specs%2Fauth-login", example: "specs%2Fauth-login" }) });
const filterQuery = {
  space: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  tag: z.string().optional(),
  owner: z.string().optional(),
};
const mode = z.enum(["direct", "branch"]).optional();

export function createApp(ctx: Ctx) {
  const metrics = new Metrics();
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return problem(c, 422, "validation failed", { errors: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    },
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "bearer", { type: "http", scheme: "bearer" });

  // ------------------------------------------------------------ logging, metrics

  app.use("*", async (c, next) => {
    const t0 = performance.now();
    await next();
    const ms = performance.now() - t0;
    const route = c.req.routePath || "unmatched";
    metrics.inc("defluance_http_requests_total", { method: c.req.method, route, status: String(c.res.status) });
    metrics.observe("defluance_http_request_duration_seconds", ms / 1000, { route });
    ctx.log({ msg: "request", method: c.req.method, path: new URL(c.req.url).pathname, status: c.res.status, ms: Math.round(ms) });
  });

  // ------------------------------------------------------------ authentication

  const resolveActor = async (c: Context): Promise<{ actor: Actor; via: "bearer" | "cookie" } | null> => {
    const header = c.req.header("authorization");
    if (header) {
      const m = /^Bearer\s+(.+)$/i.exec(header);
      const token = m?.[1] ? await ctx.sys.findToken(m[1].trim()) : null;
      return token ? { actor: actorFromToken(token, "bearer"), via: "bearer" } : null;
    }
    const session = verify<{ k: "user" | "token"; id: string; exp: number }>(getCookie(c, SESSION_COOKIE), ctx.sessionSecret, ctx.now().getTime());
    if (!session) return null;
    if (session.k === "token") {
      const t = await ctx.sys.getToken(session.id);
      return t && !t.revoked_at && (!t.expires_at || new Date(t.expires_at) > ctx.now()) ? { actor: actorFromToken(t, "cookie"), via: "cookie" } : null;
    }
    const user = await ctx.sys.getUser(session.id);
    return user ? { actor: await actorFromUser(ctx.sys, user, { admins: ctx.admins, defaultRole: ctx.defaultRole }), via: "cookie" } : null;
  };

  const csrf = (c: Context): boolean => {
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return true;
    const origin = c.req.header("origin");
    if (origin) return origin === new URL(c.req.url).origin || ctx.allowedOrigins.includes(origin);
    const site = c.req.header("sec-fetch-site");
    return !site || site === "same-origin" || site === "none";
  };

  const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
    const found = await resolveActor(c);
    if (!found) return c.body(JSON.stringify({ type: "about:blank", title: "authentication required", status: 401 }), 401, { "content-type": "application/problem+json", "www-authenticate": "Bearer" });
    if (found.via === "cookie" && !csrf(c)) return problem(c, 403, "cross-origin request refused");
    const wait = ctx.rateLimiter.take(found.actor.id);
    if (wait) {
      metrics.inc("defluance_rate_limited_total");
      return c.body(JSON.stringify({ type: "about:blank", title: "too many requests", status: 429 }), 429, { "content-type": "application/problem+json", "retry-after": String(wait) });
    }
    c.set("actor", found.actor);
    c.set("via", found.via);
    await next();
  };
  app.use("/api/v1/*", async (c, next) => (c.req.path === "/api/v1/openapi.json" ? next() : authenticate(c, next)));

  const sessionCookie = (c: Context, k: "user" | "token", id: string) =>
    setCookie(c, SESSION_COOKIE, sign({ k, id, exp: ctx.now().getTime() + SESSION_DAYS * 86_400_000 }, ctx.sessionSecret), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure: ctx.publicUrl.startsWith("https://"),
      maxAge: SESSION_DAYS * 86_400,
    });

  // ------------------------------------------------------------ errors

  app.onError((err, c) => {
    if (err instanceof HttpError) return problem(c, err.status, err.message, err.extra);
    if (err instanceof z.ZodError) return problem(c, 422, "validation failed", { errors: err.issues });
    ctx.log({ msg: "error", error: err instanceof Error ? err.stack : String(err) });
    return problem(c, 500, "internal error");
  });
  app.notFound((c) => problem(c, 404, "not found"));

  // ------------------------------------------------------------ public routes

  app.get("/health", async (c) => {
    const checks: Record<string, string> = {};
    try {
      await ctx.db.get("SELECT 1 AS ok");
      checks["database"] = "ok";
    } catch (e) {
      checks["database"] = `error: ${(e as Error).message}`;
    }
    checks["git"] = (await head(ctx.root).then(() => "ok").catch(() => "no commits yet"));
    checks["embedder"] = ctx.embedder.model;
    checks["llm"] = ctx.llm?.id ?? "none (extractive answers)";
    const healthy = checks["database"] === "ok";
    return c.json({ status: healthy ? "ok" : "degraded", checks }, healthy ? 200 : 503);
  });

  app.get("/metrics", async (c) => {
    const counts = await ctx.store.counts();
    return c.text(
      metrics.render({
        defluance_notes: counts.notes,
        defluance_chunks: counts.chunks,
        defluance_edges: counts.edges,
        defluance_embeddings_pending: (await ctx.store.counts()).pending,
        defluance_jobs_pending: await ctx.jobs.pending(),
        defluance_jobs_failed: (await ctx.jobs.failed()).length,
      }),
      200,
      { "content-type": "text/plain; version=0.0.4" },
    );
  });

  app.get("/auth/config", (c) => c.json({ oauth: !!ctx.oauth, local: ctx.localMode }));

  app.post("/auth/token-login", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { token?: unknown };
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin && !ctx.allowedOrigins.includes(origin)) return problem(c, 403, "cross-origin request refused");
    const token = typeof body.token === "string" ? await ctx.sys.findToken(body.token.trim()) : null;
    if (!token) return problem(c, 401, "invalid token");
    sessionCookie(c, "token", token.id);
    return c.json(await svc.me(ctx, actorFromToken(token, "cookie")));
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/auth/github/login", (c) => {
    if (!ctx.oauth) return problem(c, 404, "GitHub sign-in is not configured");
    const state = crypto.randomUUID();
    setCookie(c, "dfl_oauth_state", sign({ state, exp: ctx.now().getTime() + 10 * 60_000 }, ctx.sessionSecret), { httpOnly: true, sameSite: "Lax", path: "/auth", maxAge: 600, secure: ctx.publicUrl.startsWith("https://") });
    const q = new URLSearchParams({ client_id: ctx.oauth.clientId, redirect_uri: `${ctx.publicUrl}/auth/github/callback`, scope: "read:user", state });
    return c.redirect(`https://github.com/login/oauth/authorize?${q}`);
  });

  app.get("/auth/github/callback", async (c) => {
    if (!ctx.oauth) return problem(c, 404, "GitHub sign-in is not configured");
    const saved = verify<{ state: string; exp: number }>(getCookie(c, "dfl_oauth_state"), ctx.sessionSecret, ctx.now().getTime());
    const state = c.req.query("state");
    const code = c.req.query("code");
    if (!saved || !state || saved.state !== state || !code) return problem(c, 400, "invalid OAuth state");
    deleteCookie(c, "dfl_oauth_state", { path: "/auth" });
    const tokenRes = await ctx.fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: ctx.oauth.clientId, client_secret: ctx.oauth.clientSecret, code, redirect_uri: `${ctx.publicUrl}/auth/github/callback` }),
    });
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) return problem(c, 401, "GitHub refused the code");
    const userRes = await ctx.fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${access_token}`, accept: "application/vnd.github+json", "user-agent": "defluance" } });
    if (!userRes.ok) return problem(c, 502, "could not read the GitHub profile");
    const gh = (await userRes.json()) as { id: number; login: string; name?: string | null; avatar_url?: string | null };
    const user = await ctx.sys.upsertUser({ githubId: String(gh.id), login: gh.login, name: gh.name ?? null, avatar: gh.avatar_url ?? null });
    sessionCookie(c, "user", user.id);
    await ctx.sys.audit({ actorType: "user", actorId: user.id, actorName: user.login, action: "auth.login" });
    return c.redirect("/");
  });

  app.post("/webhooks/github", async (c) => {
    if (!ctx.github) return problem(c, 503, "GitHub is not configured");
    const body = await c.req.text();
    const r = await ctx.github.handleWebhook({
      event: c.req.header("x-github-event") ?? "",
      delivery: c.req.header("x-github-delivery") ?? null,
      signature: c.req.header("x-hub-signature-256") ?? null,
      body,
    });
    metrics.inc("defluance_webhooks_total", { event: c.req.header("x-github-event") ?? "unknown", status: String(r.status) });
    return c.text(r.message, r.status as never);
  });

  // ------------------------------------------------------------ MCP (bearer tokens only: no ambient cookie authority)

  app.all("/mcp", async (c) => {
    const header = c.req.header("authorization");
    const m = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
    const token = m?.[1] ? await ctx.sys.findToken(m[1].trim()) : null;
    if (!token) return c.body(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "authentication required" }, id: null }), 401, { "content-type": "application/json", "www-authenticate": "Bearer" });
    const actor = actorFromToken(token, "bearer");
    const wait = ctx.rateLimiter.take(actor.id);
    if (wait) return c.body(JSON.stringify({ jsonrpc: "2.0", error: { code: -32002, message: "too many requests" }, id: null }), 429, { "content-type": "application/json", "retry-after": String(wait) });
    if (c.req.method !== "POST") return c.body(null, 405, { allow: "POST" });
    const server = buildMcpServer(ctx, actor, (tool, success) => metrics.inc("defluance_mcp_calls_total", { tool, outcome: success ? "ok" : "error" }));
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // ------------------------------------------------------------ REST

  const actorOf = (c: Context<AppEnv>) => c.get("actor");

  app.doc31("/api/v1/openapi.json", { openapi: "3.1.0", info: { title: "Defluance API", version: "0.1.0", description: "Notes, links, search, graph, RAG and GitHub for a Markdown vault. Authenticate with `Authorization: Bearer dfl_…`." }, security: [{ bearer: [] }] });

  app.openapi(createRoute({ method: "get", path: "/api/v1/me", summary: "Current actor and its spaces", tags: ["system"], responses: { 200: ok("Actor"), ...errs } }), async (c) => c.json(await svc.me(ctx, actorOf(c)), 200));
  app.openapi(createRoute({ method: "get", path: "/api/v1/schema", summary: "Note types, statuses and link types of this vault", tags: ["system"], responses: { 200: ok("Schema"), ...errs } }), async (c) => c.json(await svc.vaultSchema(ctx), 200));
  app.openapi(createRoute({ method: "get", path: "/api/v1/spaces", summary: "Spaces the actor can read", tags: ["system"], responses: { 200: ok("Spaces"), ...errs } }), async (c) => c.json(await svc.listSpaces(ctx, actorOf(c)), 200));

  const spaceParam = z.object({ space: z.string() });
  app.openapi(createRoute({ method: "get", path: "/api/v1/spaces/{space}/members", summary: "List members of a space (admin)", tags: ["spaces"], request: { params: spaceParam }, responses: { 200: ok("Members"), ...errs } }), async (c) =>
    c.json(await svc.listMembers(ctx, actorOf(c), c.req.valid("param").space), 200),
  );
  app.openapi(createRoute({ method: "put", path: "/api/v1/spaces/{space}/members", summary: "Set a member's role (admin). The user may not have signed in yet.", tags: ["spaces"], request: { params: spaceParam, body: jsonBody(z.object({ login: z.string().min(1), role: z.enum(ROLES) })) }, responses: { 200: ok("Done"), ...errs } }), async (c) => {
    const b = c.req.valid("json");
    await svc.setMember(ctx, actorOf(c), c.req.valid("param").space, b.login, b.role);
    return c.json({ ok: true }, 200);
  });
  app.openapi(createRoute({ method: "delete", path: "/api/v1/spaces/{space}/members", summary: "Remove a member (admin)", tags: ["spaces"], request: { params: spaceParam, query: z.object({ login: z.string().min(1) }) }, responses: { 200: ok("Done"), ...errs } }), async (c) => {
    await svc.setMember(ctx, actorOf(c), c.req.valid("param").space, c.req.valid("query").login, null);
    return c.json({ ok: true }, 200);
  });

  // notes
  app.openapi(createRoute({ method: "get", path: "/api/v1/notes", summary: "List notes", tags: ["notes"], request: { query: z.object({ ...filterQuery, limit: z.coerce.number().int().min(1).max(200).optional(), after: z.string().optional().openapi({ description: "cursor: the `next` of the previous page" }), sort: z.enum(["id", "updated"]).optional() }) }, responses: { 200: ok("Page of notes"), ...errs } }), async (c) => {
    const q = c.req.valid("query");
    return c.json(await svc.listNotes(ctx, actorOf(c), q), 200);
  });

  app.openapi(createRoute({
    method: "post", path: "/api/v1/notes", summary: "Create a note", tags: ["notes"],
    description: "Send either `content` (full markdown with frontmatter) and `id`, or `type` and `title` to build from the vault template. Returns the commit SHA. Agent tokens write to a branch.",
    request: { body: jsonBody(z.object({ id: z.string().optional(), content: z.string().optional(), type: z.string().optional(), title: z.string().optional(), body: z.string().optional(), frontmatter: z.record(z.string(), z.string()).optional(), message: z.string().optional(), mode })) },
    responses: { 201: ok("Created"), ...errs },
  }), async (c) => c.json(await svc.createNote(ctx, actorOf(c), c.req.valid("json")), 201));

  app.openapi(createRoute({ method: "get", path: "/api/v1/notes/{id}", summary: "Read a note", tags: ["notes"], request: { params: idParam, query: z.object({ rev: z.string().optional().openapi({ description: "commit or branch" }) }) }, responses: { 200: ok("Note"), ...errs } }), async (c) =>
    c.json(await svc.getNote(ctx, actorOf(c), c.req.valid("param").id, { rev: c.req.valid("query").rev }), 200),
  );

  app.openapi(createRoute({
    method: "put", path: "/api/v1/notes/{id}", summary: "Replace a note", tags: ["notes"],
    description: "`base_commit` is the `commit` returned when you read the note. If the note changed since, the answer is 409 with the current commit.",
    request: { params: idParam, body: jsonBody(z.object({ content: z.string(), base_commit: z.string().optional(), message: z.string().optional(), mode })) },
    responses: { 200: ok("Committed"), ...errs },
  }), async (c) => {
    const b = c.req.valid("json");
    return c.json(await svc.updateNote(ctx, actorOf(c), c.req.valid("param").id, { content: b.content, baseCommit: b.base_commit, message: b.message, mode: b.mode }), 200);
  });

  app.openapi(createRoute({ method: "patch", path: "/api/v1/notes/{id}/status", summary: "Change a note's status", tags: ["notes"], request: { params: idParam, body: jsonBody(z.object({ status: z.string(), mode })) }, responses: { 200: ok("Committed"), ...errs } }), async (c) =>
    c.json(await svc.setStatus(ctx, actorOf(c), c.req.valid("param").id, c.req.valid("json").status, { mode: c.req.valid("json").mode }), 200),
  );

  app.openapi(createRoute({ method: "get", path: "/api/v1/notes/{id}/links", summary: "Outgoing and incoming links, grouped by type", tags: ["notes"], request: { params: idParam }, responses: { 200: ok("Links"), ...errs } }), async (c) =>
    c.json(await svc.noteLinks(ctx, actorOf(c), c.req.valid("param").id), 200),
  );
  app.openapi(createRoute({ method: "post", path: "/api/v1/notes/{id}/links", summary: "Add a typed link", tags: ["notes"], request: { params: idParam, body: jsonBody(z.object({ to: z.string(), type: z.string(), mode })) }, responses: { 201: ok("Committed"), ...errs } }), async (c) =>
    c.json(await svc.addLink(ctx, actorOf(c), c.req.valid("param").id, c.req.valid("json")), 201),
  );
  app.openapi(createRoute({ method: "get", path: "/api/v1/notes/{id}/history", summary: "Commits touching a note, or the diff of one commit", tags: ["notes"], request: { params: idParam, query: z.object({ diff: z.string().optional() }) }, responses: { 200: ok("History"), ...errs } }), async (c) =>
    c.json(await svc.noteHistory(ctx, actorOf(c), c.req.valid("param").id, { diff: c.req.valid("query").diff }), 200),
  );
  app.openapi(createRoute({ method: "post", path: "/api/v1/notes/{id}/issues", summary: "Open a GitHub issue from a note and link it", tags: ["github"], request: { params: idParam, body: jsonBody(z.object({ repo: z.string().optional(), title: z.string().optional(), body: z.string().optional(), labels: z.array(z.string()).optional() })) }, responses: { 201: ok("Issue created"), ...errs } }), async (c) =>
    c.json(await svc.createIssueFromNote(ctx, actorOf(c), c.req.valid("param").id, c.req.valid("json")), 201),
  );

  // search, graph, ask
  app.openapi(createRoute({
    method: "get", path: "/api/v1/search", summary: "Search by words, by meaning, or both", tags: ["search"],
    description: "`mode`: `keyword` matches words, `meaning` compares vectors (needs a real embedding model, see `capabilities` in /me), `hybrid` (default) fuses both. `passages` returns more than the best passage of each note.",
    request: { query: z.object({ q: z.string().min(1), ...filterQuery, limit: z.coerce.number().int().min(1).max(50).optional(), mode: z.enum(["keyword", "meaning", "hybrid"]).optional(), passages: z.coerce.number().int().min(1).max(5).optional() }) },
    responses: { 200: ok("Hits"), ...errs },
  }), async (c) => {
    const { q, ...f } = c.req.valid("query");
    return c.json(await svc.searchNotes(ctx, actorOf(c), q, f), 200);
  });
  app.openapi(createRoute({
    method: "get", path: "/api/v1/search/smart", summary: "Search with a language model in front", tags: ["search"],
    description: "The model rewrites the question into several searches (and the other language), infers filters such as \"approved specs\", and can rerank. `understood` says what it did. Without a model configured, the answer is plain hybrid search and `understood.fallback` says so.",
    request: { query: z.object({ q: z.string().min(1), ...filterQuery, limit: z.coerce.number().int().min(1).max(30).optional(), passages: z.coerce.number().int().min(1).max(5).optional(), rerank: z.enum(["true", "false"]).optional() }) },
    responses: { 200: ok("Hits and what was understood"), ...errs },
  }), async (c) => {
    const { q, rerank, ...f } = c.req.valid("query");
    return c.json(await svc.smartSearchNotes(ctx, actorOf(c), q, { ...f, rerank: rerank === "true" }), 200);
  });

  const gid = z.object({ id: z.string().min(1) });
  app.openapi(createRoute({ method: "get", path: "/api/v1/graph/neighbors", summary: "Notes linked to a note", tags: ["graph"], request: { query: gid.extend({ link: z.string().optional(), direction: z.enum(["in", "out", "both"]).optional(), depth: z.coerce.number().int().min(1).max(5).optional() }) }, responses: { 200: ok("Subgraph"), ...errs } }), async (c) => {
    const { id, ...o } = c.req.valid("query");
    return c.json(await svc.graphNeighborsOf(ctx, actorOf(c), id, o), 200);
  });
  app.openapi(createRoute({ method: "get", path: "/api/v1/graph/path", summary: "Shortest path between two notes", tags: ["graph"], request: { query: z.object({ from: z.string(), to: z.string(), max_depth: z.coerce.number().int().min(1).max(10).optional() }) }, responses: { 200: ok("Path"), ...errs } }), async (c) => {
    const q = c.req.valid("query");
    return c.json(await svc.graphPathOf(ctx, actorOf(c), q.from, q.to, q.max_depth), 200);
  });
  app.openapi(createRoute({
    method: "get", path: "/api/v1/graph/impact", summary: "What a change touches", tags: ["graph"],
    description: "With `id`: notes that depend on, implement or test the note, plus GitHub objects tracking them. With `pr=owner/repo#n`: notes tied to the pull request (tracked_by, or component `paths` matching its files) and what they impact.",
    request: { query: z.object({ id: z.string().optional(), pr: z.string().optional(), depth: z.coerce.number().int().min(1).max(5).optional() }) },
    responses: { 200: ok("Impact"), ...errs },
  }), async (c) => {
    const q = c.req.valid("query");
    if (q.pr) return c.json(await svc.impactOfPullRequest(ctx, actorOf(c), q.pr), 200);
    if (!q.id) throw new HttpError(422, "give `id` or `pr`");
    return c.json(await svc.graphImpactOf(ctx, actorOf(c), q.id, q.depth), 200);
  });
  app.openapi(createRoute({ method: "get", path: "/api/v1/graph/lint", summary: "Orphan notes and broken links", tags: ["graph"], responses: { 200: ok("Report"), ...errs } }), async (c) => c.json(await svc.graphLintOf(ctx, actorOf(c)), 200));
  app.openapi(createRoute({ method: "get", path: "/api/v1/graph/overview", summary: "The most connected notes and the links among them", tags: ["graph"], request: { query: z.object({ limit: z.coerce.number().int().min(10).max(500).optional() }) }, responses: { 200: ok("Subgraph"), ...errs } }), async (c) =>
    c.json(await svc.graphOverview(ctx, actorOf(c), c.req.valid("query").limit), 200),
  );

  app.openapi(createRoute({
    method: "post", path: "/api/v1/ask", summary: "Ask a question, answered from the notes with citations", tags: ["search"],
    description: "Every claim cites a note, heading and commit. When no note supports an answer the result has `refused: true`.",
    request: { body: jsonBody(z.object({ question: z.string().min(1), ...filterQuery, scope_note: z.string().optional().openapi({ description: "limit retrieval to this note and its neighbours" }), scope_depth: z.number().int().min(1).max(3).optional(), deep: z.boolean().optional().openapi({ description: "let the model search, read notes and follow links over several steps (needs a model that supports tools). The answer lists the steps taken." }), max_steps: z.number().int().min(2).max(10).optional() })) },
    responses: { 200: ok("Answer"), ...errs },
  }), async (c) => {
    const { question, scope_note, scope_depth, deep, max_steps, ...f } = c.req.valid("json");
    return c.json(await svc.askQuestion(ctx, actorOf(c), question, { ...f, scopeNote: scope_note, scopeDepth: scope_depth, deep, maxSteps: max_steps }), 200);
  });

  // index, audit, tokens
  app.openapi(createRoute({ method: "get", path: "/api/v1/index/status", summary: "Index status", tags: ["system"], responses: { 200: ok("Status"), ...errs } }), async (c) => c.json(await svc.indexStatus(ctx), 200));
  app.openapi(createRoute({ method: "post", path: "/api/v1/index/rebuild", summary: "Drop and rebuild the index from the vault (admin)", tags: ["system"], responses: { 200: ok("Status"), ...errs } }), async (c) => c.json(await svc.rebuildIndex(ctx, actorOf(c)), 200));

  app.openapi(createRoute({ method: "get", path: "/api/v1/audit", summary: "Audit log (admin)", tags: ["system"], request: { query: z.object({ actor: z.string().optional(), action: z.string().optional(), target: z.string().optional(), from: z.string().optional(), to: z.string().optional(), before: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() }) }, responses: { 200: ok("Entries"), ...errs } }), async (c) =>
    c.json(await svc.auditLog(ctx, actorOf(c), c.req.valid("query")), 200),
  );

  app.openapi(createRoute({ method: "get", path: "/api/v1/tokens", summary: "API tokens you can manage", tags: ["tokens"], responses: { 200: ok("Tokens"), ...errs } }), async (c) => c.json(await svc.listTokens(ctx, actorOf(c)), 200));
  app.openapi(createRoute({
    method: "post", path: "/api/v1/tokens", summary: "Create an API token", tags: ["tokens"],
    description: "The token value is returned once. `spaces: []` means every space. You can only grant what you hold yourself.",
    request: { body: jsonBody(z.object({ name: z.string().min(1).max(80), scopes: z.array(z.enum(PERMS)).min(1), spaces: z.array(z.string()).default([]), expires_in_days: z.number().int().min(1).max(3650).optional() })) },
    responses: { 201: ok("Token"), ...errs },
  }), async (c) => {
    const b = c.req.valid("json");
    return c.json(await svc.createToken(ctx, actorOf(c), { name: b.name, scopes: b.scopes, spaces: b.spaces, expiresInDays: b.expires_in_days }), 201);
  });
  app.openapi(createRoute({ method: "delete", path: "/api/v1/tokens/{id}", summary: "Revoke a token", tags: ["tokens"], request: { params: z.object({ id: z.string() }) }, responses: { 200: ok("Revoked"), ...errs } }), async (c) => {
    await svc.revokeToken(ctx, actorOf(c), c.req.valid("param").id);
    return c.json({ ok: true }, 200);
  });

  // github
  app.openapi(createRoute({ method: "get", path: "/api/v1/github/status", summary: "GitHub connector status", tags: ["github"], responses: { 200: ok("Status"), ...errs } }), async (c) => {
    const config = await ctx.getConfig();
    return c.json({ configured: !!ctx.github, repos: ctx.github ? await ctx.github.repos().catch(() => []) : [], spaces: config.spaces.map((s) => ({ name: s.name, repos: s.repos })), defaultRepos: config.repos, webhookUrl: `${ctx.publicUrl}/webhooks/github`, oauth: !!ctx.oauth }, 200);
  });
  app.openapi(createRoute({ method: "get", path: "/api/v1/github/nodes/{owner}/{repo}/{n}", summary: "A cached issue or pull request", tags: ["github"], request: { params: z.object({ owner: z.string(), repo: z.string(), n: z.string() }) }, responses: { 200: ok("Node"), ...errs } }), async (c) => {
    const p = c.req.valid("param");
    const node = await ctx.store.ghNode(`${p.owner}/${p.repo}#${p.n}`);
    if (!node) throw new HttpError(404, "GitHub object not found (not synced yet?)");
    return c.json(node, 200);
  });
  app.openapi(createRoute({ method: "post", path: "/api/v1/github/resync", summary: "Re-read issues and pull requests from GitHub (admin)", tags: ["github"], responses: { 200: ok("Counts"), ...errs } }), async (c) => {
    const actor = actorOf(c);
    if (!svc.isAdmin(actor)) throw new HttpError(403, "requires admin on every space");
    if (!ctx.github) throw new HttpError(503, "GitHub is not configured");
    const r = await ctx.github.resync();
    await svc.audit(ctx, actor, "github.resync", null, r);
    return c.json(r, 200);
  });

  // ------------------------------------------------------------ UI

  app.get("*", async (c) => {
    if (!ctx.uiDir) return problem(c, 404, "not found");
    const hit = await resolveStatic(ctx.uiDir, new URL(c.req.url).pathname);
    if (!hit) {
      const nf = await resolveStatic(ctx.uiDir, "/404.html");
      return nf ? c.body(new Uint8Array(await readStatic(nf.file)), 404, { "content-type": nf.type }) : problem(c, 404, "not found");
    }
    const immutable = new URL(c.req.url).pathname.startsWith("/_next/static/");
    return c.body(new Uint8Array(await readStatic(hit.file)), 200, { "content-type": hit.type, "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
  });

  return { app, metrics };
}
