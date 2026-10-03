import type { Ctx } from "../context.js";
import { HttpError } from "../errors.js";
import * as svc from "../services/index.js";
import { actorOf, router } from "./http.js";

/**
 * Pictures, PDFs, audio and video that live in the vault next to the notes. Served only to people who can read the
 * space they are in, and never in a way that could run: `nosniff`, and SVG in a sandbox.
 */
export function fileRoutes(ctx: Ctx) {
  const r = router();

  r.get("/api/v1/files/*", async (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname.slice("/api/v1/files/".length));
    const f = await svc.readVaultFile(ctx, actorOf(c), path);
    const inline = /^(image|audio|video)\//.test(f.type) || f.type === "application/pdf";
    return c.body(new Uint8Array(f.data), 200, {
      "content-type": f.type,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/[^\w.-]/g, "_")}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
    });
  });

  r.post("/api/v1/files", async (c) => {
    const body = await c.req.parseBody().catch(() => null);
    const file = body?.["file"];
    const note = body?.["note"];
    if (!(file instanceof File) || typeof note !== "string") throw new HttpError(422, "send multipart form data with `file` and `note`");
    const out = await svc.uploadFile(ctx, actorOf(c), { note, name: file.name, data: Buffer.from(await file.arrayBuffer()) });
    return c.json(out, out.existed ? 200 : 201);
  });
  return r;
}
