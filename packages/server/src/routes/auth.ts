import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { actorFromToken, actorFromUser, sign, verify, type Actor } from "../auth.js";
import type { Ctx } from "../context.js";
import type { Metrics } from "../metrics.js";
import * as svc from "../services/index.js";
import { type AppEnv, problem, router } from "./http.js";

export const SESSION_COOKIE = "dfl_session";
const SESSION_DAYS = 7;

/** Bearer token or signed session cookie → actor, with CSRF and rate-limit checks. */
export function authenticate(ctx: Ctx, metrics: Metrics): MiddlewareHandler<AppEnv> {
  const resolveActor = async (c: Context): Promise<{ actor: Actor; via: "bearer" | "cookie" } | null> => {
    const header = c.req.header("authorization");
    if (header) {
      const m = /^Bearer\s+(.+)$/i.exec(header);
      const token = m?.[1] ? await ctx.sys.findToken(m[1].trim()) : null;
      return token ? { actor: actorFromToken(token, "bearer"), via: "bearer" } : null;
    }
    const session = verify<{ k: "user" | "token"; id: string; exp: number }>(getCookie(c, SESSION_COOKIE), ctx.sessionSecret, ctx.now().getTime());
    if (!session) return null;
    if (session.k === "token") {
      const t = await ctx.sys.getToken(session.id);
      return t && !t.revoked_at && (!t.expires_at || new Date(t.expires_at) > ctx.now()) ? { actor: actorFromToken(t, "cookie"), via: "cookie" } : null;
    }
    const user = await ctx.sys.getUser(session.id);
    return user ? { actor: await actorFromUser(ctx.sys, user, { admins: ctx.admins, defaultRole: ctx.defaultRole }), via: "cookie" } : null;
  };

  const csrf = (c: Context): boolean => {
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return true;
    const origin = c.req.header("origin");
    if (origin) return origin === new URL(c.req.url).origin || ctx.allowedOrigins.includes(origin);
    const site = c.req.header("sec-fetch-site");
    return !site || site === "same-origin" || site === "none";
  };

  return async (c, next) => {
    const found = await resolveActor(c);
    if (!found) return c.body(JSON.stringify({ type: "about:blank", title: "authentication required", status: 401 }), 401, { "content-type": "application/problem+json", "www-authenticate": "Bearer" });
    if (found.via === "cookie" && !csrf(c)) return problem(c, 403, "cross-origin request refused");
    const wait = ctx.rateLimiter.take(found.actor.id);
    if (wait) {
      metrics.inc("defluance_rate_limited_total");
      return c.body(JSON.stringify({ type: "about:blank", title: "too many requests", status: 429 }), 429, { "content-type": "application/problem+json", "retry-after": String(wait) });
    }
    c.set("actor", found.actor);
    c.set("via", found.via);
    await next();
  };
}

export function authRoutes(ctx: Ctx) {
  const r = router();
  const sessionCookie = (c: Context, k: "user" | "token", id: string) =>
    setCookie(c, SESSION_COOKIE, sign({ k, id, exp: ctx.now().getTime() + SESSION_DAYS * 86_400_000 }, ctx.sessionSecret), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure: ctx.publicUrl.startsWith("https://"),
      maxAge: SESSION_DAYS * 86_400,
    });

  r.get("/auth/config", (c) => c.json({ oauth: !!ctx.oauth, local: ctx.localMode }));

  r.post("/auth/token-login", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { token?: unknown };
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin && !ctx.allowedOrigins.includes(origin)) return problem(c, 403, "cross-origin request refused");
    const token = typeof body.token === "string" ? await ctx.sys.findToken(body.token.trim()) : null;
    if (!token) return problem(c, 401, "invalid token");
    sessionCookie(c, "token", token.id);
    return c.json(await svc.me(ctx, actorFromToken(token, "cookie")));
  });

  r.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  r.get("/auth/github/login", (c) => {
    if (!ctx.oauth) return problem(c, 404, "GitHub sign-in is not configured");
    const state = crypto.randomUUID();
    setCookie(c, "dfl_oauth_state", sign({ state, exp: ctx.now().getTime() + 10 * 60_000 }, ctx.sessionSecret), { httpOnly: true, sameSite: "Lax", path: "/auth", maxAge: 600, secure: ctx.publicUrl.startsWith("https://") });
    const q = new URLSearchParams({ client_id: ctx.oauth.clientId, redirect_uri: `${ctx.publicUrl}/auth/github/callback`, scope: "read:user", state });
    return c.redirect(`https://github.com/login/oauth/authorize?${q}`);
  });

  r.get("/auth/github/callback", async (c) => {
    if (!ctx.oauth) return problem(c, 404, "GitHub sign-in is not configured");
    const saved = verify<{ state: string; exp: number }>(getCookie(c, "dfl_oauth_state"), ctx.sessionSecret, ctx.now().getTime());
    const state = c.req.query("state");
    const code = c.req.query("code");
    if (!saved || !state || saved.state !== state || !code) return problem(c, 400, "invalid OAuth state");
    deleteCookie(c, "dfl_oauth_state", { path: "/auth" });
    const tokenRes = await ctx.fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: ctx.oauth.clientId, client_secret: ctx.oauth.clientSecret, code, redirect_uri: `${ctx.publicUrl}/auth/github/callback` }),
    });
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) return problem(c, 401, "GitHub refused the code");
    const userRes = await ctx.fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${access_token}`, accept: "application/vnd.github+json", "user-agent": "defluance" } });
    if (!userRes.ok) return problem(c, 502, "could not read the GitHub profile");
    const gh = (await userRes.json()) as { id: number; login: string; name?: string | null; avatar_url?: string | null };
    const user = await ctx.sys.upsertUser({ githubId: String(gh.id), login: gh.login, name: gh.name ?? null, avatar: gh.avatar_url ?? null });
    sessionCookie(c, "user", user.id);
    await ctx.sys.audit({ actorType: "user", actorId: user.id, actorName: user.login, action: "auth.login" });
    return c.redirect("/");
  });
  return r;
}

