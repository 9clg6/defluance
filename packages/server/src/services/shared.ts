import { type NoteRow } from "@defluance/indexer";
import { type Author } from "@defluance/vault-core";
import { type Actor, can, readableSpaces } from "../auth.js";
import { type Ctx } from "../context.js";
import { HttpError, forbidden, notFound } from "../errors.js";
import { type Perm } from "../system.js";

// ---------------------------------------------------------------- helpers

export const spaceNames = async (ctx: Ctx) => ["default", ...(await ctx.getConfig()).spaces.map((s) => s.name)];

/** Spaces the actor may read. `undefined`: no restriction. */
export async function readSpaces(ctx: Ctx, actor: Actor): Promise<string[] | undefined> {
  return readableSpaces(actor, await spaceNames(ctx));
}

export const authorOf = (a: Actor): Author => ({ name: a.name, email: `${a.id}@defluance.local` });

export const audit = (ctx: Ctx, actor: Actor, action: string, target: string | null, payload: Record<string, unknown> = {}, commit: string | null = null) =>
  ctx.sys.audit({ actorType: actor.kind, actorId: actor.id, actorName: actor.name, action, target, payload, commit });

/** A note id is a relative path without `.md`. Anything that could leave the vault is rejected. */
export function safeId(raw: string): string {
  const id = raw.replace(/\.md$/i, "");
  const parts = id.split("/");
  if (!id || id.length > 200 || id.includes("\\") || id.includes("\0") || parts.some((p) => !p || p === "." || p === ".." || p.startsWith("."))) {
    throw new HttpError(400, `invalid note id "${raw}"`);
  }
  return id;
}

const REV = /^[A-Za-z0-9][\w./-]{0,100}$/;
export const checkRev = (rev: string) => {
  if (!REV.test(rev)) throw new HttpError(400, "invalid revision");
  return rev;
};

export async function requireNote(ctx: Ctx, actor: Actor, id: string, perm: Perm = "read"): Promise<NoteRow> {
  const note = await ctx.store.getNote(safeId(id));
  // 404, not 403: do not reveal notes the actor cannot see.
  if (!note || !can(actor, "read", note.space)) throw notFound("note");
  if (perm !== "read" && !can(actor, perm, note.space)) throw forbidden(`requires "${perm}" on space "${note.space}"`);
  return note;
}
