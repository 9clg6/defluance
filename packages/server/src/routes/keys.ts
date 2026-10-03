import { createRoute, z } from "@hono/zod-openapi";
import type { Ctx } from "../context.js";
import * as svc from "../services/index.js";
import { actorOf, errs, jsonBody, ok, router } from "./http.js";

const fpParam = z.object({ fp: z.string().regex(/^[0-9a-f]{32}$/, "a key fingerprint: 32 hex characters") });

/** Keys for private notes. Passphrases arrive in a request body and are never logged or audited. */
export function keyRoutes(ctx: Ctx) {
  const r = router();
  r.openapi(createRoute({
    method: "get", path: "/api/v1/keys", summary: "Your keys, which are unlocked, and the public keys notes can be encrypted for", tags: ["private notes"],
    responses: { 200: ok("Keys"), ...errs },
  }), async (c) => c.json(await svc.listKeys(ctx, actorOf(c)), 200));

  r.openapi(createRoute({
    method: "post", path: "/api/v1/keys", summary: "Create a key pair", tags: ["private notes"],
    description: "The private key is generated here, protected by your passphrase and stored only in that protected form; the public key is committed to the vault keyring. There is no way to recover a forgotten passphrase: download a backup.",
    request: { body: jsonBody(z.object({ label: z.string().min(1).max(80), passphrase: z.string().min(10).max(500) })) },
    responses: { 201: ok("Key"), ...errs },
  }), async (c) => c.json(await svc.createKey(ctx, actorOf(c), c.req.valid("json")), 201));

  r.openapi(createRoute({
    method: "post", path: "/api/v1/keys/lock", summary: "Lock every key you have unlocked", tags: ["private notes"],
    responses: { 200: ok("Done"), ...errs },
  }), async (c) => c.json(await svc.lockKeys(ctx, actorOf(c)), 200));

  r.openapi(createRoute({
    method: "post", path: "/api/v1/keys/{fp}/unlock", summary: "Unlock a key with its passphrase", tags: ["private notes"],
    description: "The key stays unlocked in server memory for this session, until 30 minutes without use or 8 hours at most. Five wrong passphrases lock the key out for 15 minutes.",
    request: { params: fpParam, body: jsonBody(z.object({ passphrase: z.string().min(1).max(500) })) },
    responses: { 200: ok("Key status"), ...errs },
  }), async (c) => c.json(await svc.unlockKey(ctx, actorOf(c), c.req.valid("param").fp, c.req.valid("json").passphrase), 200));

  r.openapi(createRoute({
    method: "post", path: "/api/v1/keys/{fp}/lock", summary: "Lock one key", tags: ["private notes"],
    request: { params: fpParam }, responses: { 200: ok("Done"), ...errs },
  }), async (c) => c.json(await svc.lockKeys(ctx, actorOf(c), c.req.valid("param").fp), 200));

  r.openapi(createRoute({
    method: "get", path: "/api/v1/keys/{fp}/backup", summary: "Download your protected private key", tags: ["private notes"],
    description: "A JSON file that only your passphrase opens. Keep it somewhere safe: if the server loses its database, this is the only copy of the key.",
    request: { params: fpParam }, responses: { 200: ok("Protected key"), ...errs },
  }), async (c) => c.json(await svc.backupKey(ctx, actorOf(c), c.req.valid("param").fp), 200));

  r.openapi(createRoute({
    method: "delete", path: "/api/v1/keys/{fp}", summary: "Delete a key from the server", tags: ["private notes"],
    description: "Removes the protected private key. Notes encrypted for it can no longer be opened with this server unless you restore a backup.",
    request: { params: fpParam }, responses: { 200: ok("Done"), ...errs },
  }), async (c) => c.json(await svc.deleteKey(ctx, actorOf(c), c.req.valid("param").fp), 200));
  return r;
}
