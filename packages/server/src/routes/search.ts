import { createRoute, z } from "@hono/zod-openapi";
import type { Ctx } from "../context.js";
import { HttpError } from "../errors.js";
import * as svc from "../services/index.js";
import { actorOf, errs, filterQuery, jsonBody, ok, router } from "./http.js";

export function searchRoutes(ctx: Ctx) {
  const r = router();
  // search, graph, ask
  r.openapi(createRoute({
    method: "get", path: "/api/v1/search", summary: "Search by words, by meaning, or both", tags: ["search"],
    description: "`mode`: `keyword` matches words, `meaning` compares vectors (needs a real embedding model, see `capabilities` in /me), `hybrid` (default) fuses both. `passages` returns more than the best passage of each note.",
    request: { query: z.object({ q: z.string().min(1), ...filterQuery, limit: z.coerce.number().int().min(1).max(50).optional(), mode: z.enum(["keyword", "meaning", "hybrid"]).optional(), passages: z.coerce.number().int().min(1).max(5).optional() }) },
    responses: { 200: ok("Hits"), ...errs },
  }), async (c) => {
    const { q, ...f } = c.req.valid("query");
    return c.json(await svc.searchNotes(ctx, actorOf(c), q, f), 200);
  });
  r.openapi(createRoute({
    method: "get", path: "/api/v1/search/smart", summary: "Search with a language model in front", tags: ["search"],
    description: "The model rewrites the question into several searches (and the other language), infers filters such as \"approved specs\", and can rerank. `understood` says what it did. Without a model configured, the answer is plain hybrid search and `understood.fallback` says so.",
    request: { query: z.object({ q: z.string().min(1), ...filterQuery, limit: z.coerce.number().int().min(1).max(30).optional(), passages: z.coerce.number().int().min(1).max(5).optional(), rerank: z.enum(["true", "false"]).optional() }) },
    responses: { 200: ok("Hits and what was understood"), ...errs },
  }), async (c) => {
    const { q, rerank, ...f } = c.req.valid("query");
    return c.json(await svc.smartSearchNotes(ctx, actorOf(c), q, { ...f, rerank: rerank === "true" }), 200);
  });

  const gid = z.object({ id: z.string().min(1) });
  r.openapi(createRoute({ method: "get", path: "/api/v1/graph/neighbors", summary: "Notes linked to a note", tags: ["graph"], request: { query: gid.extend({ link: z.string().optional(), direction: z.enum(["in", "out", "both"]).optional(), depth: z.coerce.number().int().min(1).max(5).optional() }) }, responses: { 200: ok("Subgraph"), ...errs } }), async (c) => {
    const { id, ...o } = c.req.valid("query");
    return c.json(await svc.graphNeighborsOf(ctx, actorOf(c), id, o), 200);
  });
  r.openapi(createRoute({ method: "get", path: "/api/v1/graph/path", summary: "Shortest path between two notes", tags: ["graph"], request: { query: z.object({ from: z.string(), to: z.string(), max_depth: z.coerce.number().int().min(1).max(10).optional() }) }, responses: { 200: ok("Path"), ...errs } }), async (c) => {
    const q = c.req.valid("query");
    return c.json(await svc.graphPathOf(ctx, actorOf(c), q.from, q.to, q.max_depth), 200);
  });
  r.openapi(createRoute({
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
  r.openapi(createRoute({ method: "get", path: "/api/v1/graph/lint", summary: "Orphan notes and broken links", tags: ["graph"], responses: { 200: ok("Report"), ...errs } }), async (c) => c.json(await svc.graphLintOf(ctx, actorOf(c)), 200));
  r.openapi(createRoute({ method: "get", path: "/api/v1/graph/overview", summary: "The most connected notes and the links among them", tags: ["graph"], request: { query: z.object({ limit: z.coerce.number().int().min(10).max(500).optional() }) }, responses: { 200: ok("Subgraph"), ...errs } }), async (c) =>
    c.json(await svc.graphOverview(ctx, actorOf(c), c.req.valid("query").limit), 200),
  );

  r.openapi(createRoute({
    method: "post", path: "/api/v1/ask", summary: "Ask a question, answered from the notes with citations", tags: ["search"],
    description: "Every claim cites a note, heading and commit. When no note supports an answer the result has `refused: true`.",
    request: { body: jsonBody(z.object({ question: z.string().min(1), ...filterQuery, scope_note: z.string().optional().openapi({ description: "limit retrieval to this note and its neighbours" }), scope_depth: z.number().int().min(1).max(3).optional(), deep: z.boolean().optional().openapi({ description: "let the model search, read notes and follow links over several steps (needs a model that supports tools). The answer lists the steps taken." }), max_steps: z.number().int().min(2).max(10).optional() })) },
    responses: { 200: ok("Answer"), ...errs },
  }), async (c) => {
    const { question, scope_note, scope_depth, deep, max_steps, ...f } = c.req.valid("json");
    return c.json(await svc.askQuestion(ctx, actorOf(c), question, { ...f, scopeNote: scope_note, scopeDepth: scope_depth, deep, maxSteps: max_steps }), 200);
  });
  return r;
}

