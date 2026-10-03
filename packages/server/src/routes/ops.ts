import { head } from "@defluance/vault-core";
import type { Ctx } from "../context.js";
import type { Metrics } from "../metrics.js";
import { problem, router } from "./http.js";

/** Health, metrics and the GitHub webhook: no user authentication. */
export function opsRoutes(ctx: Ctx, metrics: Metrics) {
  const r = router();
  r.get("/health", async (c) => {
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

  r.get("/metrics", async (c) => {
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

  r.post("/webhooks/github", async (c) => {
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
  return r;
}

