import { createRoute, z } from "@hono/zod-openapi";
import type { Ctx } from "../context.js";
import * as svc from "../services/index.js";
import { actorOf, errs, jsonBody, ok, router } from "./http.js";

const branch = z.string().min(1).max(200).openapi({ description: "Branch name, `defluance/<agent>/<note>`", example: "defluance/claude-code/specs-auth" });

/** Drafts written by agents on branches, for a person to review. The branch is a query parameter because it contains slashes. */
export function draftRoutes(ctx: Ctx) {
  const r = router();
  r.openapi(createRoute({
    method: "get", path: "/api/v1/drafts", summary: "Drafts waiting for review", tags: ["drafts"],
    description: "Branches agents wrote to, with what they changed and whether they still merge cleanly.",
    responses: { 200: ok("Drafts"), ...errs },
  }), async (c) => c.json(await svc.listDrafts(ctx, actorOf(c)), 200));

  r.openapi(createRoute({
    method: "get", path: "/api/v1/drafts/diff", summary: "What a draft changes", tags: ["drafts"],
    request: { query: z.object({ branch }) }, responses: { 200: ok("Files with their patch"), ...errs },
  }), async (c) => c.json(await svc.draftDiff(ctx, actorOf(c), c.req.valid("query").branch), 200));

  r.openapi(createRoute({
    method: "post", path: "/api/v1/drafts/merge", summary: "Merge a draft into the main branch", tags: ["drafts"],
    description: "Needs a person (not an agent) with `write` on every space the draft touches. A conflict answers 409 and changes nothing.",
    request: { body: jsonBody(z.object({ branch })) }, responses: { 200: ok("Merged"), ...errs },
  }), async (c) => c.json(await svc.mergeDraft(ctx, actorOf(c), c.req.valid("json").branch), 200));

  r.openapi(createRoute({
    method: "post", path: "/api/v1/drafts/discard", summary: "Throw a draft away", tags: ["drafts"],
    request: { body: jsonBody(z.object({ branch })) }, responses: { 200: ok("Discarded"), ...errs },
  }), async (c) => c.json(await svc.discardDraft(ctx, actorOf(c), c.req.valid("json").branch), 200));

  r.openapi(createRoute({
    method: "post", path: "/api/v1/drafts/pull-request", summary: "Open a GitHub pull request for a draft", tags: ["drafts"],
    description: "Pushes the branch to `origin` and opens a pull request in `vault_repo`.",
    request: { body: jsonBody(z.object({ branch })) }, responses: { 201: ok("Pull request"), ...errs },
  }), async (c) => c.json(await svc.draftPullRequest(ctx, actorOf(c), c.req.valid("json").branch), 201));
  return r;
}
