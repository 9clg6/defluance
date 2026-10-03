import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeServer, type TestServer } from "./test-env.js";

let s: TestServer;
beforeAll(async () => void (s = await makeServer()));
afterAll(async () => s.cleanup());

describe("HTTP hardening", () => {
  it("sets security headers, a restrictive CSP and no HSTS over plain http", async () => {
    const r = await s.call("GET", "/health", { token: null });
    const csp = r.res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(r.res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.res.headers.get("strict-transport-security")).toBeNull();
  });

  it("sends HSTS when the public URL is https", async () => {
    const https = await makeServer({ env: { DFL_PUBLIC_URL: "https://specs.example.com" } });
    try {
      const r = await https.call("GET", "/health", { token: null });
      expect(r.res.headers.get("strict-transport-security")).toContain("max-age=");
    } finally {
      await https.cleanup();
    }
  });

  it("tags every response with a request id and honours an incoming one", async () => {
    const a = await s.call("GET", "/health", { token: null });
    expect(a.res.headers.get("x-request-id")).toMatch(/\S{8,}/);
    const b = await s.call("GET", "/health", { token: null, headers: { "x-request-id": "trace-me-0001" } });
    expect(b.res.headers.get("x-request-id")).toBe("trace-me-0001");
  });

  it("refuses an oversized body with a problem document", async () => {
    const big = "x".repeat(6 * 1024 * 1024);
    const r = await s.call("POST", "/api/v1/notes", { body: { id: "big", content: big } });
    expect(r.status).toBe(413);
    expect(r.body.title).toBe("request body too large");
    const login = await s.call("POST", "/auth/token-login", { token: null, body: { token: "x".repeat(100_000) } });
    expect(login.status).toBe(413);
  });

  it("answers an unsupported content type as a problem, not a crash", async () => {
    const r = await s.request("/api/v1/notes", { method: "POST", headers: { authorization: `Bearer ${s.admin}`, "content-type": "application/json" }, body: "{not json" });
    expect([400, 422]).toContain(r.status);
    expect(r.headers.get("content-type")).toContain("problem+json");
  });

  it("compresses large JSON for clients that accept it, but never the MCP endpoint", async () => {
    const big = await s.request("/api/v1/openapi.json", { headers: { "accept-encoding": "gzip" } });
    expect(big.headers.get("content-encoding")).toBe("gzip");
    const mcp = await s.request("/mcp", { method: "POST", headers: { authorization: `Bearer ${s.admin}`, "content-type": "application/json", accept: "application/json, text/event-stream", "accept-encoding": "gzip" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(mcp.headers.get("content-encoding")).toBeNull();
  });
});
