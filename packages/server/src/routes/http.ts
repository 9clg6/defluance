import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { Actor } from "../auth.js";

export type AppEnv = { Variables: { actor: Actor; via: "bearer" | "cookie" } };

export const Problem = z.object({ type: z.string(), title: z.string(), status: z.number(), detail: z.string().optional() }).openapi("Problem");

export function problem(c: Context, status: number, title: string, extra: Record<string, unknown> = {}) {
  return c.body(JSON.stringify({ type: "about:blank", title, status, ...extra }), status as never, { "content-type": "application/problem+json" });
}

export const ok = (description: string, schema: z.ZodType = z.any()) => ({ description, content: { "application/json": { schema } } });
export const errs = { default: { description: "Error", content: { "application/problem+json": { schema: Problem } } } };
export const jsonBody = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } }, required: true as const });

export const idParam = z.object({ id: z.string().min(1).openapi({ description: "Note id (path without .md), URL-encoded: specs%2Fauth-login", example: "specs%2Fauth-login" }) });
export const filterQuery = {
  space: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  tag: z.string().optional(),
  owner: z.string().optional(),
};
export const mode = z.enum(["direct", "branch"]).optional();

export const actorOf = (c: Context<AppEnv>) => c.get("actor");

/** A router whose validation failures are RFC 9457 problem documents. */
export const router = () =>
  new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return problem(c, 422, "validation failed", { errors: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    },
  });
