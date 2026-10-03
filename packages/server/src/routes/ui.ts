import type { Ctx } from "../context.js";
import { resolveStatic, readStatic } from "../static.js";
import { problem, router } from "./http.js";

export function uiRoutes(ctx: Ctx) {
  const r = router();
  r.get("*", async (c) => {
    if (!ctx.uiDir) return problem(c, 404, "not found");
    const hit = await resolveStatic(ctx.uiDir, new URL(c.req.url).pathname);
    if (!hit) {
      const nf = await resolveStatic(ctx.uiDir, "/404.html");
      return nf ? c.body(new Uint8Array(await readStatic(nf.file)), 404, { "content-type": nf.type }) : problem(c, 404, "not found");
    }
    const immutable = new URL(c.req.url).pathname.startsWith("/_next/static/");
    return c.body(new Uint8Array(await readStatic(hit.file)), 200, { "content-type": hit.type, "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
  });
  return r;
}

