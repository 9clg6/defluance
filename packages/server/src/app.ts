import { z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { Ctx } from "./context.js";
import { HttpError } from "./errors.js";
import { Metrics } from "./metrics.js";
import { useMiddleware } from "./middleware.js";
import { authenticate, authRoutes } from "./routes/auth.js";
import { draftRoutes } from "./routes/drafts.js";
import { githubRoutes } from "./routes/github.js";
import { problem, router } from "./routes/http.js";
import { keyRoutes } from "./routes/keys.js";
import { mcpRoute } from "./routes/mcp.js";
import { noteRoutes } from "./routes/notes.js";
import { opsRoutes } from "./routes/ops.js";
import { searchRoutes } from "./routes/search.js";
import { systemRoutes } from "./routes/system.js";
import { uiRoutes } from "./routes/ui.js";

export { SESSION_COOKIE } from "./routes/auth.js";

/** Composition root of the HTTP layer: middleware, then one sub-router per concern, UI last (it owns `*`). */
export function createApp(ctx: Ctx) {
  const metrics = new Metrics();
  const app = router();

  app.openAPIRegistry.registerComponent("securitySchemes", "bearer", { type: "http", scheme: "bearer" });
  useMiddleware(app, ctx, metrics);

  const auth = authenticate(ctx, metrics);
  app.use("/api/v1/*", async (c, next) => (c.req.path === "/api/v1/openapi.json" ? next() : auth(c, next)));

  app.onError((err, c) => {
    if (err instanceof HttpError) return problem(c, err.status, err.message, err.extra);
    if (err instanceof HTTPException) return problem(c, err.status, err.message);
    if (err instanceof z.ZodError) return problem(c, 422, "validation failed", { errors: err.issues });
    ctx.log({ msg: "error", id: c.get("requestId"), error: err instanceof Error ? err.stack : String(err) });
    return problem(c, 500, "internal error");
  });
  app.notFound((c) => problem(c, 404, "not found"));

  app.doc31("/api/v1/openapi.json", { openapi: "3.1.0", info: { title: "Defluance API", version: "0.1.0", description: "Notes, links, search, graph, RAG and GitHub for a Markdown vault. Authenticate with `Authorization: Bearer dfl_…`." }, security: [{ bearer: [] }] });

  app.route("/", opsRoutes(ctx, metrics));
  app.route("/", authRoutes(ctx));
  app.route("/", mcpRoute(ctx, metrics));
  app.route("/", systemRoutes(ctx));
  app.route("/", keyRoutes(ctx));
  app.route("/", noteRoutes(ctx));
  app.route("/", searchRoutes(ctx));
  app.route("/", draftRoutes(ctx));
  app.route("/", githubRoutes(ctx));
  app.route("/", uiRoutes(ctx));

  return { app, metrics };
}
