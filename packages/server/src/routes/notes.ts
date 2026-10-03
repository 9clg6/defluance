import { createRoute, z } from "@hono/zod-openapi";
import type { Ctx } from "../context.js";
import * as svc from "../services/index.js";
import { actorOf, errs, filterQuery, idParam, jsonBody, mode, ok, router } from "./http.js";

export function noteRoutes(ctx: Ctx) {
  const r = router();
  r.openapi(createRoute({ method: "get", path: "/api/v1/stats", summary: "Notes by type and status", tags: ["notes"], responses: { 200: ok("Counts"), ...errs } }), async (c) => c.json(await svc.noteStats(ctx, actorOf(c)), 200));
  r.openapi(createRoute({ method: "get", path: "/api/v1/notes", summary: "List notes", tags: ["notes"], request: { query: z.object({ ...filterQuery, limit: z.coerce.number().int().min(1).max(200).optional(), after: z.string().optional().openapi({ description: "cursor: the `next` of the previous page" }), sort: z.enum(["id", "updated"]).optional() }) }, responses: { 200: ok("Page of notes"), ...errs } }), async (c) => {
    const q = c.req.valid("query");
    return c.json(await svc.listNotes(ctx, actorOf(c), q), 200);
  });

  r.openapi(createRoute({
    method: "post", path: "/api/v1/notes", summary: "Create a note", tags: ["notes"],
    description: "Send either `content` (full markdown with frontmatter) and `id`, or `type` and `title` to build from the vault template. Returns the commit SHA. Agent tokens write to a branch.",
    request: { body: jsonBody(z.object({ id: z.string().optional(), content: z.string().optional(), type: z.string().optional(), title: z.string().optional(), body: z.string().optional(), frontmatter: z.record(z.string(), z.string()).optional(), message: z.string().optional(), mode, private: z.boolean().optional().openapi({ description: "encrypt the note, for your own keys" }), recipients: z.array(z.string()).optional().openapi({ description: "extra recipients: key fingerprints from GET /keys. Implies private." }) })) },
    responses: { 201: ok("Created"), ...errs },
  }), async (c) => c.json(await svc.createNote(ctx, actorOf(c), c.req.valid("json")), 201));

  r.openapi(createRoute({ method: "get", path: "/api/v1/notes/{id}", summary: "Read a note", tags: ["notes"], request: { params: idParam, query: z.object({ rev: z.string().optional().openapi({ description: "commit or branch" }) }) }, responses: { 200: ok("Note"), ...errs } }), async (c) =>
    c.json(await svc.getNote(ctx, actorOf(c), c.req.valid("param").id, { rev: c.req.valid("query").rev }), 200),
  );

  r.openapi(createRoute({
    method: "put", path: "/api/v1/notes/{id}", summary: "Replace a note", tags: ["notes"],
    description: "`base_commit` is the `commit` returned when you read the note. If the note changed since, the answer is 409 with the current commit.",
    request: { params: idParam, body: jsonBody(z.object({ content: z.string(), base_commit: z.string().optional(), message: z.string().optional(), mode })) },
    responses: { 200: ok("Committed"), ...errs },
  }), async (c) => {
    const b = c.req.valid("json");
    return c.json(await svc.updateNote(ctx, actorOf(c), c.req.valid("param").id, { content: b.content, baseCommit: b.base_commit, message: b.message, mode: b.mode }), 200);
  });

  r.openapi(createRoute({ method: "patch", path: "/api/v1/notes/{id}/status", summary: "Change a note's status", tags: ["notes"], request: { params: idParam, body: jsonBody(z.object({ status: z.string(), mode })) }, responses: { 200: ok("Committed"), ...errs } }), async (c) =>
    c.json(await svc.setStatus(ctx, actorOf(c), c.req.valid("param").id, c.req.valid("json").status, { mode: c.req.valid("json").mode }), 200),
  );

  r.openapi(createRoute({
    method: "post", path: "/api/v1/notes/{id}/encrypt", summary: "Encrypt a note", tags: ["private notes"],
    description: "Encrypts the note for your keys and any `recipients`. Earlier versions stay readable in git history: the answer carries a warning.",
    request: { params: idParam, body: jsonBody(z.object({ recipients: z.array(z.string()).optional() })) }, responses: { 200: ok("Committed"), ...errs },
  }), async (c) => c.json(await svc.encryptExisting(ctx, actorOf(c), c.req.valid("param").id, c.req.valid("json")), 200));
  r.openapi(createRoute({
    method: "post", path: "/api/v1/notes/{id}/decrypt", summary: "Make a private note plain again", tags: ["private notes"],
    description: "Needs an unlocked key that is a recipient.", request: { params: idParam }, responses: { 200: ok("Committed"), ...errs },
  }), async (c) => c.json(await svc.decryptExisting(ctx, actorOf(c), c.req.valid("param").id), 200));
  r.openapi(createRoute({
    method: "put", path: "/api/v1/notes/{id}/recipients", summary: "Change who can read a private note", tags: ["private notes"],
    description: "Adding wraps the note key for the new person. Removing encrypts the note again under a new key; a copy they already hold stays readable.",
    request: { params: idParam, body: jsonBody(z.object({ add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() })) }, responses: { 200: ok("Recipients"), ...errs },
  }), async (c) => c.json(await svc.setRecipients(ctx, actorOf(c), c.req.valid("param").id, c.req.valid("json")), 200));

  r.openapi(createRoute({ method: "get", path: "/api/v1/notes/{id}/links", summary: "Outgoing and incoming links, grouped by type", tags: ["notes"], request: { params: idParam }, responses: { 200: ok("Links"), ...errs } }), async (c) =>
    c.json(await svc.noteLinks(ctx, actorOf(c), c.req.valid("param").id), 200),
  );
  r.openapi(createRoute({ method: "post", path: "/api/v1/notes/{id}/links", summary: "Add a typed link", tags: ["notes"], request: { params: idParam, body: jsonBody(z.object({ to: z.string(), type: z.string(), mode })) }, responses: { 201: ok("Committed"), ...errs } }), async (c) =>
    c.json(await svc.addLink(ctx, actorOf(c), c.req.valid("param").id, c.req.valid("json")), 201),
  );
  r.openapi(createRoute({ method: "get", path: "/api/v1/notes/{id}/history", summary: "Commits touching a note, or the diff of one commit", tags: ["notes"], request: { params: idParam, query: z.object({ diff: z.string().optional() }) }, responses: { 200: ok("History"), ...errs } }), async (c) =>
    c.json(await svc.noteHistory(ctx, actorOf(c), c.req.valid("param").id, { diff: c.req.valid("query").diff }), 200),
  );
  r.openapi(createRoute({ method: "post", path: "/api/v1/notes/{id}/issues", summary: "Open a GitHub issue from a note and link it", tags: ["github"], request: { params: idParam, body: jsonBody(z.object({ repo: z.string().optional(), title: z.string().optional(), body: z.string().optional(), labels: z.array(z.string()).optional() })) }, responses: { 201: ok("Issue created"), ...errs } }), async (c) =>
    c.json(await svc.createIssueFromNote(ctx, actorOf(c), c.req.valid("param").id, c.req.valid("json")), 201),
  );
  return r;
}

