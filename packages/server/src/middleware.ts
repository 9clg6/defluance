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
  // Files from the vault get a stricter policy than pages: an SVG opened on its own must not be able to run script.
  // Registered before secureHeaders so that this runs after it and has the last word.
  app.use("/api/v1/files/*", async (c, next) => {
    await next();
    c.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  });
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
        // Safari does not let 'self' cover WebSockets: name the origin of live editing explicitly.
        connectSrc: ["'self'", ctx.publicUrl.replace(/^http/, "ws")],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }),
  );

  // API answers can carry private text: no browser or proxy cache may keep them. (A route that sets its own policy, such as
  // a file that can be reused for a few minutes, keeps it.)
  app.use("/api/*", async (c, next) => {
    await next();
    if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
  });

  // Body size: webhooks may carry up to 25 MB (GitHub's cap), the API a few MB, auth forms almost nothing.
  app.use("/webhooks/*", limit(26 * MB));
  app.use("/mcp", limit(5 * MB));
  // File uploads may be bigger than other calls; the route checks its own, smaller, limit on the file itself.
  const apiLimit = limit(5 * MB);
  const uploadLimit = limit(12 * MB);
  app.use("/api/*", (c, next) => (c.req.path === "/api/v1/files" && c.req.method === "POST" ? uploadLimit(c, next) : apiLimit(c, next)));
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
