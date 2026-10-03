import { createHmac, timingSafeEqual } from "node:crypto";
import { DEFAULT_SPACE } from "@defluance/vault-core";
import type { Ctx } from "./context.js";
import { ROLE_PERMS, type Perm, type Role, type SystemStore, type TokenRow, type UserRow } from "./system.js";

export interface Grant {
  /** Space name, or `*` for every space. */
  space: string;
  perms: ReadonlySet<Perm>;
}

export interface Actor {
  kind: "user" | "token";
  id: string;
  name: string;
  grants: Grant[];
  /**
   * Programmatic caller: writes go to a branch, drafts only, no approvals.
   * True for Bearer tokens without the `admin` scope. A person in a browser session is never an agent.
   */
  agent: boolean;
}

export function can(actor: Actor, perm: Perm, space: string): boolean {
  return actor.grants.some((g) => (g.space === "*" || g.space === space) && g.perms.has(perm));
}

/** Spaces the actor can read among `known`. `undefined` means all of them. */
export function readableSpaces(actor: Actor, known: string[]): string[] | undefined {
  if (actor.grants.some((g) => g.space === "*" && g.perms.has("read"))) return undefined;
  return known.filter((s) => can(actor, "read", s));
}

export function actorFromToken(t: TokenRow, via: "bearer" | "cookie" = "bearer"): Actor {
  const perms = new Set(t.scopes);
  // `write` implies `read`: an agent that can edit a note must be able to see it.
  if (perms.has("write") || perms.has("issues") || perms.has("admin")) perms.add("read");
  const spaces = t.spaces.length ? t.spaces : ["*"];
  return { kind: "token", id: t.id, name: t.name, agent: via === "bearer" && !t.scopes.includes("admin"), grants: spaces.map((space) => ({ space, perms })) };
}

export async function actorFromUser(sys: SystemStore, user: UserRow, opts: { admins: string[]; defaultRole: Role | null }): Promise<Actor> {
  const grants: Grant[] = [];
  if (opts.admins.map((a) => a.toLowerCase()).includes(user.login.toLowerCase())) {
    grants.push({ space: "*", perms: new Set(ROLE_PERMS.admin) });
  } else {
    if (opts.defaultRole) grants.push({ space: "*", perms: new Set(ROLE_PERMS[opts.defaultRole]) });
    for (const m of await sys.memberships(user.id)) grants.push({ space: m.space, perms: new Set(ROLE_PERMS[m.role]) });
  }
  return { kind: "user", id: user.id, name: user.login, agent: false, grants };
}

export const spaceOrDefault = (s: string | undefined) => s ?? DEFAULT_SPACE;

export const SESSION_COOKIE = "dfl_session";

/** Who is calling: a Bearer token, or a signed session cookie. Shared by HTTP requests and WebSocket upgrades. */
export async function actorFromRequest(ctx: Pick<Ctx, "sys" | "keys" | "sessionSecret" | "now" | "admins" | "defaultRole">, r: { authorization?: string | undefined; session?: string | undefined }): Promise<{ actor: Actor; via: "bearer" | "cookie" } | null> {
  if (r.authorization) {
    const m = /^Bearer\s+(.+)$/i.exec(r.authorization);
    const plaintext = m?.[1]?.trim();
    const token = plaintext ? await ctx.sys.findToken(plaintext) : null;
    if (!token || !plaintext) return null;
    // An agent's own token also unlocks the key bound to it (cached, so this is a lookup after the first call).
    await ctx.keys.unlockWithToken(token.id, plaintext);
    return { actor: actorFromToken(token, "bearer"), via: "bearer" };
  }
  const session = verify<{ k: "user" | "token"; id: string; exp: number }>(r.session, ctx.sessionSecret, ctx.now().getTime());
  if (!session) return null;
  if (session.k === "token") {
    const t = await ctx.sys.getToken(session.id);
    return t && !t.revoked_at && (!t.expires_at || new Date(t.expires_at) > ctx.now()) ? { actor: actorFromToken(t, "cookie"), via: "cookie" } : null;
  }
  const user = await ctx.sys.getUser(session.id);
  return user ? { actor: await actorFromUser(ctx.sys, user, { admins: ctx.admins, defaultRole: ctx.defaultRole }), via: "cookie" } : null;
}

// ---------------------------------------------------------------- signed cookies

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function sign(payload: Record<string, unknown>, secret: string): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function verify<T extends { exp?: number }>(value: string | undefined, secret: string, now = Date.now()): T | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    return data.exp && data.exp < now ? null : data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- rate limit

/** Token bucket per key, in memory. Multi-instance deployments need a shared store (see architecture). */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds to wait, or 0 when the request is allowed. */
  take(key: string): number {
    if (this.perMinute <= 0) return 0;
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.perMinute, at: t };
    b.tokens = Math.min(this.perMinute, b.tokens + ((t - b.at) / 60_000) * this.perMinute);
    b.at = t;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return Math.ceil(((1 - b.tokens) / this.perMinute) * 60);
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return 0;
  }
}
