import { createRoute, z } from "@hono/zod-openapi";
import type { Ctx } from "../context.js";
import * as svc from "../services/index.js";
import { PERMS, ROLES } from "../system.js";
import { actorOf, errs, jsonBody, ok, router } from "./http.js";

export function systemRoutes(ctx: Ctx) {
  const r = router();
  r.openapi(createRoute({ method: "get", path: "/api/v1/me", summary: "Current actor and its spaces", tags: ["system"], responses: { 200: ok("Actor"), ...errs } }), async (c) => c.json(await svc.me(ctx, actorOf(c)), 200));
  r.openapi(createRoute({ method: "get", path: "/api/v1/schema", summary: "Note types, statuses and link types of this vault", tags: ["system"], responses: { 200: ok("Schema"), ...errs } }), async (c) => c.json(await svc.vaultSchema(ctx), 200));
  r.openapi(createRoute({ method: "get", path: "/api/v1/spaces", summary: "Spaces the actor can read", tags: ["system"], responses: { 200: ok("Spaces"), ...errs } }), async (c) => c.json(await svc.listSpaces(ctx, actorOf(c)), 200));

  const spaceParam = z.object({ space: z.string() });
  r.openapi(createRoute({ method: "get", path: "/api/v1/spaces/{space}/members", summary: "List members of a space (admin)", tags: ["spaces"], request: { params: spaceParam }, responses: { 200: ok("Members"), ...errs } }), async (c) =>
    c.json(await svc.listMembers(ctx, actorOf(c), c.req.valid("param").space), 200),
  );
  r.openapi(createRoute({ method: "put", path: "/api/v1/spaces/{space}/members", summary: "Set a member's role (admin). The user may not have signed in yet.", tags: ["spaces"], request: { params: spaceParam, body: jsonBody(z.object({ login: z.string().min(1), role: z.enum(ROLES) })) }, responses: { 200: ok("Done"), ...errs } }), async (c) => {
    const b = c.req.valid("json");
    await svc.setMember(ctx, actorOf(c), c.req.valid("param").space, b.login, b.role);
    return c.json({ ok: true }, 200);
  });
  r.openapi(createRoute({ method: "delete", path: "/api/v1/spaces/{space}/members", summary: "Remove a member (admin)", tags: ["spaces"], request: { params: spaceParam, query: z.object({ login: z.string().min(1) }) }, responses: { 200: ok("Done"), ...errs } }), async (c) => {
    await svc.setMember(ctx, actorOf(c), c.req.valid("param").space, c.req.valid("query").login, null);
    return c.json({ ok: true }, 200);
  });

  // index, audit, tokens
  r.openapi(createRoute({ method: "get", path: "/api/v1/index/status", summary: "Index status", tags: ["system"], responses: { 200: ok("Status"), ...errs } }), async (c) => c.json(await svc.indexStatus(ctx), 200));
  r.openapi(createRoute({ method: "post", path: "/api/v1/index/rebuild", summary: "Drop and rebuild the index from the vault (admin)", tags: ["system"], responses: { 200: ok("Status"), ...errs } }), async (c) => c.json(await svc.rebuildIndex(ctx, actorOf(c)), 200));

  r.openapi(createRoute({ method: "get", path: "/api/v1/audit", summary: "Audit log (admin)", tags: ["system"], request: { query: z.object({ actor: z.string().optional(), action: z.string().optional(), target: z.string().optional(), from: z.string().optional(), to: z.string().optional(), before: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() }) }, responses: { 200: ok("Entries"), ...errs } }), async (c) =>
    c.json(await svc.auditLog(ctx, actorOf(c), c.req.valid("query")), 200),
  );

  r.openapi(createRoute({ method: "get", path: "/api/v1/tokens", summary: "API tokens you can manage", tags: ["tokens"], responses: { 200: ok("Tokens"), ...errs } }), async (c) => c.json(await svc.listTokens(ctx, actorOf(c)), 200));
  r.openapi(createRoute({
    method: "post", path: "/api/v1/tokens", summary: "Create an API token", tags: ["tokens"],
    description: "The token value is returned once. `spaces: []` means every space. You can only grant what you hold yourself.",
    request: { body: jsonBody(z.object({ name: z.string().min(1).max(80), scopes: z.array(z.enum(PERMS)).min(1), spaces: z.array(z.string()).default([]), expires_in_days: z.number().int().min(1).max(3650).optional(), private_key: z.boolean().optional().openapi({ description: "also create a key protected by the token itself, so this agent can read private notes shared with it" }) })) },
    responses: { 201: ok("Token"), ...errs },
  }), async (c) => {
    const b = c.req.valid("json");
    return c.json(await svc.createToken(ctx, actorOf(c), { name: b.name, scopes: b.scopes, spaces: b.spaces, expiresInDays: b.expires_in_days, privateKey: b.private_key }), 201);
  });
  r.openapi(createRoute({ method: "delete", path: "/api/v1/tokens/{id}", summary: "Revoke a token", tags: ["tokens"], request: { params: z.object({ id: z.string() }) }, responses: { 200: ok("Revoked"), ...errs } }), async (c) => {
    await svc.revokeToken(ctx, actorOf(c), c.req.valid("param").id);
    return c.json({ ok: true }, 200);
  });
  return r;
}

