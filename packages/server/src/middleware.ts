import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import type { Ctx } from "./context.js";
import type { AppEnv } from "./routes/http.js";
import type { Metrics } from "./metrics.js";
import { problem } from "./routes/http.js";

const KB = 1024;
const MB = 1024 * KB;

const late = (ms: number) => timeout(ms, () => new HTTPException(504, { message: "request timed out" }));
const limit = (maxSize: number) => bodyLimit({ maxSize, onError: (c) => problem(c, 413, "request body too large") });

/**
 * Cross-cutting concerns, in the order Hono documents them: identify, harden, bound, compress, measure.
 * CSP keeps 'unsafe-inline' because the Next.js static export inlines its bootstrap and the theme script;
 * everything else is locked to the same origin.
 */
export function useMiddleware(app: Hono<AppEnv>, ctx: Ctx, metrics: Metrics): void {
  const https = ctx.publicUrl.startsWith("https://");

  app.use("*", requestId());
  app.use(
    "*",
    secureHeaders({
      strictTransportSecurity: https ? "max-age=15552000; includeSubDomains" : false,
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://avatars.githubusercontent.com"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }),
  );

  // Body size: webhooks may carry up to 25 MB (GitHub's cap), the API a few MB, auth forms almost nothing.
  app.use("/webhooks/*", limit(26 * MB));
  app.use("/mcp", limit(5 * MB));
  app.use("/api/*", limit(5 * MB));
  app.use("/auth/*", limit(64 * KB));

  // Time: model calls are slow on purpose, everything else is not.
  app.use("/api/v1/ask", late(120_000));
  app.use("/api/v1/search/smart", late(60_000));
  app.use("/api/*", late(30_000));

  const gzip = compress();
  app.use("*", async (c, next) => (c.req.path === "/mcp" ? next() : gzip(c, next)));

  app.use("*", async (c, next) => {
    const t0 = performance.now();
    await next();
    const ms = performance.now() - t0;
    const route = c.req.routePath || "unmatched";
    metrics.inc("defluance_http_requests_total", { method: c.req.method, route, status: String(c.res.status) });
    metrics.observe("defluance_http_request_duration_seconds", ms / 1000, { route });
    ctx.log({ msg: "request", id: c.get("requestId"), method: c.req.method, path: new URL(c.req.url).pathname, status: c.res.status, ms: Math.round(ms) });
  });
}
