import { spaceOf } from "@defluance/vault-core";
import { type Actor, actorFromToken, can } from "../auth.js";
import { type Ctx, indexNow } from "../context.js";
import { HttpError, forbidden, notFound } from "../errors.js";
import { type AuditFilter, PERMS, type Perm, ROLES, type Role } from "../system.js";
import { audit, authorOf, readSpaces, spaceNames } from "./shared.js";

// ---------------------------------------------------------------- admin

export async function rebuildIndex(ctx: Ctx, actor: Actor) {
  if (!can(actor, "admin", "*")) throw forbidden("requires admin on every space");
  for (const t of ["chunks", "edges", "notes", "embedding_cache", "meta"]) await ctx.db.run(`DELETE FROM ${t}`);
  await indexNow(ctx);
  await audit(ctx, actor, "index.rebuild", null);
  return indexStatus(ctx);
}

export async function indexStatus(ctx: Ctx) {
  const counts = await ctx.store.counts();
  return {
    ...counts,
    embedding: { ...ctx.embedding, pending: counts.pending },
    capabilities: capabilities(ctx),
    embed_model: (await ctx.store.getMeta("embed_model")) || null,
    last_commit: (await ctx.store.getMeta("last_commit")) ?? null,
    indexed_at: (await ctx.store.getMeta("indexed_at")) ?? null,
    jobs_pending: await ctx.jobs.pending(),
    jobs_failed: (await ctx.jobs.failed()).length,
  };
}

export const isGlobalAdmin = (actor: Actor) => can(actor, "admin", "*");
export const isAdmin = isGlobalAdmin;

/** Spaces a token covers, `[]` meaning all. The actor must hold admin on each. */
export async function checkTokenSpaces(ctx: Ctx, actor: Actor, spaces: string[]) {
  if (spaces.length === 0) {
    if (!isGlobalAdmin(actor)) throw forbidden("a token for every space needs admin on every space");
    return;
  }
  const known = await spaceNames(ctx);
  for (const s of spaces) {
    if (!known.includes(s)) throw new HttpError(422, `unknown space "${s}"`);
    if (!can(actor, "admin", s)) throw forbidden(`requires admin on space "${s}"`);
  }
}

export async function createToken(ctx: Ctx, actor: Actor, input: { name: string; scopes: Perm[]; spaces: string[]; expiresInDays?: number | undefined; privateKey?: boolean | undefined }) {
  await checkTokenSpaces(ctx, actor, input.spaces);
  const targets = input.spaces.length ? input.spaces : ["*"];
  for (const sc of input.scopes) for (const s of targets) if (!can(actor, sc, s)) throw forbidden(`you cannot grant "${sc}" on "${s}"`);
  if (!input.scopes.every((s) => PERMS.includes(s)) || input.scopes.length === 0) throw new HttpError(422, "scopes must be a non-empty subset of read, write, issues, admin");
  const { token, row } = await ctx.sys.createToken({ name: input.name, scopes: input.scopes, spaces: input.spaces, createdBy: actor.name, ...(input.expiresInDays ? { expiresInDays: input.expiresInDays } : {}) });
  await audit(ctx, actor, "token.create", row.id, { name: row.name, scopes: row.scopes, spaces: row.spaces });
  // A key the token itself protects: the agent that holds the token can read the private notes shared with it.
  let key: { fp: string; label: string } | undefined;
  if (input.privateKey) {
    const k = await ctx.keys.create({ kind: "token", id: row.id }, { label: row.name, passphrase: token, bound: "token", author: authorOf(actor) });
    key = { fp: k.fp, label: k.label };
    await audit(ctx, actor, "key.create", k.fp, { owner: `token:${row.id}`, label: k.label });
  }
  return { token, ...row, ...(key ? { key } : {}) };
}

export async function listTokens(ctx: Ctx, actor: Actor) {
  const all = await ctx.sys.listTokens();
  return all.filter((t) => (t.spaces.length ? t.spaces.every((s) => can(actor, "admin", s)) : isGlobalAdmin(actor)));
}

export async function revokeToken(ctx: Ctx, actor: Actor, id: string) {
  const t = await ctx.sys.getToken(id);
  if (!t || t.revoked_at) throw notFound("token");
  await checkTokenSpaces(ctx, actor, t.spaces);
  await ctx.sys.revokeToken(id);
  ctx.keys.forget(id);
  for (const k of await ctx.sys.keysOf(id)) ctx.priv.drop(k.fp);
  await audit(ctx, actor, "token.revoke", id, { name: t.name });
}

export async function listSpaces(ctx: Ctx, actor: Actor) {
  const config = await ctx.getConfig();
  const readable = await readSpaces(ctx, actor);
  const all = [{ name: "default", path: "", repos: config.repos }, ...config.spaces];
  return all
    .filter((s) => !readable || readable.includes(s.name))
    .map((s) => ({ name: s.name, path: s.path, repos: s.repos.length ? s.repos : config.repos, perms: PERMS.filter((p) => can(actor, p, s.name)) }));
}

export async function listMembers(ctx: Ctx, actor: Actor, space: string) {
  if (!(await spaceNames(ctx)).includes(space)) throw notFound("space");
  if (!can(actor, "admin", space)) throw forbidden(`requires admin on space "${space}"`);
  return (await ctx.sys.members(space)).map((m) => ({ login: m.user.login, name: m.user.name, role: m.role }));
}

export async function setMember(ctx: Ctx, actor: Actor, space: string, login: string, role: Role | null) {
  if (!(await spaceNames(ctx)).includes(space)) throw notFound("space");
  if (!can(actor, "admin", space)) throw forbidden(`requires admin on space "${space}"`);
  if (role && !ROLES.includes(role)) throw new HttpError(422, "role must be reader, editor or admin");
  const user = await ctx.sys.ensureUserByLogin(login);
  if (role) await ctx.sys.setRole(user.id, space, role);
  else await ctx.sys.removeMember(user.id, space);
  await audit(ctx, actor, "member.set", space, { login, role });
}

export async function auditLog(ctx: Ctx, actor: Actor, f: AuditFilter) {
  // Global admins read everything. Space admins only see entries about notes of their spaces.
  if (isGlobalAdmin(actor)) return ctx.sys.listAudit(f);
  const config = await ctx.getConfig();
  const adminSpaces = (await spaceNames(ctx)).filter((s) => can(actor, "admin", s));
  if (!adminSpaces.length) throw forbidden("requires admin");
  const entries = await ctx.sys.listAudit({ ...f, limit: 500 });
  return entries.filter((e) => e.target && adminSpaces.includes(spaceOf(config, e.target))).slice(0, f.limit ?? 100);
}

/** What search can do on this server, so the interface offers only what works. */
export function capabilities(ctx: Ctx) {
  return {
    /** Vectors from a real model: search by meaning. The `hash` embedder only matches shared words. */
    semantic: !ctx.embedder.model.startsWith("hash"),
    embedder: ctx.embedder.model,
    llm: ctx.llm?.id ?? null,
    /** Deep search needs a model that can call tools. */
    deep: !!ctx.llm?.model,
    /** Several people can edit a note at the same time and see each other. */
    collab: true,
  };
}

export async function me(ctx: Ctx, actor: Actor) {
  return { kind: actor.kind, id: actor.id, name: actor.name, spaces: await listSpaces(ctx, actor), oauth: !!ctx.oauth, local: ctx.localMode, capabilities: capabilities(ctx) };
}

export { actorFromToken };
