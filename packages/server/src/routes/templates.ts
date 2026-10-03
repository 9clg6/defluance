import { createRoute, z } from "@hono/zod-openapi";
import type { Ctx } from "../context.js";
import * as svc from "../services/index.js";
import { actorOf, errs, jsonBody, ok, router } from "./http.js";

export function templateRoutes(ctx: Ctx) {
  const r = router();
  const name = z.object({ name: z.string().min(1).openapi({ description: "lowercase letters, digits and dashes, e.g. `functional-spec`", example: "rfc" }) });
  r.openapi(createRoute({
    method: "get", path: "/api/v1/templates", summary: "Templates for new notes", tags: ["templates"],
    description: "Built-in templates and the files of `.defluance/templates`. `source`: `builtin`, `vault` (a file with a new name) or `override` (a file replacing a built-in). `<!-- ai: ... -->` comments are guidance for the language model that fills a note.",
    responses: { 200: ok("Templates"), ...errs },
  }), async (c) => c.json(await svc.listTemplates(ctx), 200));
  r.openapi(createRoute({
    method: "put", path: "/api/v1/templates/{name}", summary: "Create or replace a template (admin)", tags: ["templates"],
    description: "Committed to the vault as `template: <name>`. The template must produce a note that parses (checked with sample values) and is at most 20 KB. Agents cannot call it.",
    request: { params: name, body: jsonBody(z.object({ content: z.string() })) }, responses: { 200: ok("Committed"), ...errs },
  }), async (c) => c.json(await svc.putTemplate(ctx, actorOf(c), c.req.valid("param").name, c.req.valid("json").content), 200));
  r.openapi(createRoute({
    method: "delete", path: "/api/v1/templates/{name}", summary: "Delete a vault template (admin)", tags: ["templates"],
    description: "Removes the file: an override goes back to the built-in. 404 when the vault has no such file. Agents cannot call it.",
    request: { params: name }, responses: { 200: ok("Committed"), ...errs },
  }), async (c) => c.json(await svc.deleteTemplate(ctx, actorOf(c), c.req.valid("param").name), 200));
  return r;
}
