import { createRoute, z } from "@hono/zod-openapi";
import type { Ctx } from "../context.js";
import { HttpError } from "../errors.js";
import * as svc from "../services/index.js";
import { actorOf, errs, jsonBody, ok, router } from "./http.js";

export function githubRoutes(ctx: Ctx) {
  const r = router();
  // github
  r.openapi(createRoute({ method: "get", path: "/api/v1/github/status", summary: "GitHub connector status", tags: ["github"], responses: { 200: ok("Status"), ...errs } }), async (c) => {
    const config = await ctx.getConfig();
    return c.json({ configured: !!ctx.github, repos: ctx.github ? await ctx.github.repos().catch(() => []) : [], spaces: config.spaces.map((s) => ({ name: s.name, repos: s.repos })), defaultRepos: config.repos, vaultRepo: config.vaultRepo, webhookUrl: `${ctx.publicUrl}/webhooks/github`, oauth: !!ctx.oauth }, 200);
  });
  r.openapi(createRoute({ method: "get", path: "/api/v1/github/nodes/{owner}/{repo}/{n}", summary: "A cached issue or pull request", tags: ["github"], request: { params: z.object({ owner: z.string(), repo: z.string(), n: z.string() }) }, responses: { 200: ok("Node"), ...errs } }), async (c) => {
    const p = c.req.valid("param");
    const node = await ctx.store.ghNode(`${p.owner}/${p.repo}#${p.n}`);
    if (!node) throw new HttpError(404, "GitHub object not found (not synced yet?)");
    return c.json(node, 200);
  });
  r.openapi(createRoute({
    method: "get", path: "/api/v1/github/items", summary: "Search issues and pull requests", tags: ["github"],
    description: "Cached issues and pull requests of the repositories linked to the spaces you can read, newest first. `q` is a number (`12`, `#12`: that number comes first) or text matched against title, labels, author and key.",
    request: { query: z.object({
      q: z.string().optional(), repo: z.string().optional(),
      kind: z.enum(["issue", "pull-request"]).optional(), state: z.enum(["open", "closed", "merged"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }) },
    responses: { 200: ok("{ items: GhNode[] }"), ...errs },
  }), async (c) => c.json(await svc.listGithubItems(ctx, actorOf(c), c.req.valid("query")), 200));
  r.openapi(createRoute({
    method: "put", path: "/api/v1/github/repos", summary: "Link or unlink a repository (admin)", tags: ["github"],
    description: "Edits `.defluance/config.yaml` (the `repos` of `space`, or the top-level `repos`), commits `github: link <repo>`, then syncs that repository in the background. The repository must be one the GitHub App can see. Agents cannot call it.",
    request: { body: jsonBody(z.object({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "owner/name"), space: z.string().optional(), linked: z.boolean() })) },
    responses: { 200: ok("{ repo, space, linked, changed, commit }"), ...errs },
  }), async (c) => c.json(await svc.setGithubRepo(ctx, actorOf(c), c.req.valid("json")), 200));
  r.openapi(createRoute({ method: "post", path: "/api/v1/github/resync", summary: "Re-read issues and pull requests from GitHub (admin)", tags: ["github"], responses: { 200: ok("Counts"), ...errs } }), async (c) => {
    const actor = actorOf(c);
    if (!svc.isAdmin(actor)) throw new HttpError(403, "requires admin on every space");
    if (!ctx.github) throw new HttpError(503, "GitHub is not configured");
    const r = await ctx.github.resync();
    await svc.audit(ctx, actor, "github.resync", null, r);
    return c.json(r, 200);
  });
  return r;
}

