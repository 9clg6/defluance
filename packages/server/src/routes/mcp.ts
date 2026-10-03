import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { actorFromToken } from "../auth.js";
import type { Ctx } from "../context.js";
import { buildMcpServer } from "../mcp.js";
import type { Metrics } from "../metrics.js";
import { router } from "./http.js";

/** MCP over HTTP. Bearer tokens only: no ambient cookie authority. */
export function mcpRoute(ctx: Ctx, metrics: Metrics) {
  const r = router();
  r.all("/mcp", async (c) => {
    const header = c.req.header("authorization");
    const m = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
    const token = m?.[1] ? await ctx.sys.findToken(m[1].trim()) : null;
    if (!token) return c.body(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "authentication required" }, id: null }), 401, { "content-type": "application/json", "www-authenticate": "Bearer" });
    await ctx.keys.unlockWithToken(token.id, m?.[1]?.trim() ?? "");
    const actor = actorFromToken(token, "bearer");
    const wait = ctx.rateLimiter.take(actor.id);
    if (wait) return c.body(JSON.stringify({ jsonrpc: "2.0", error: { code: -32002, message: "too many requests" }, id: null }), 429, { "content-type": "application/json", "retry-after": String(wait) });
    if (c.req.method !== "POST") return c.body(null, 405, { allow: "POST" });
    const server = buildMcpServer(ctx, actor, (tool, success) => metrics.inc("defluance_mcp_calls_total", { tool, outcome: success ? "ok" : "error" }));
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  return r;
}

