import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type NoteRow } from "@defluance/indexer";
import { DecryptError, decryptNote, readHeader, readKeyring, resolveRecipients, type Recipient } from "@defluance/vault-core";
import { type Actor } from "../auth.js";
import { type Ctx } from "../context.js";
import { HttpError } from "../errors.js";
import { type Held } from "../keys.js";
import { isPrivateRow, recipientsOfRow, type PrivateNote } from "../private-index.js";

export { isPrivateRow, recipientsOfRow };

/** Name of each key in the vault keyring: what a person sees instead of a fingerprint. */
export async function keyLabels(ctx: Ctx, fps: string[]): Promise<{ fp: string; label: string; owner: string | null }[]> {
  const by = new Map((await readKeyring(ctx.root)).map((e) => [e.fp, e]));
  return fps.map((fp) => ({ fp, label: by.get(fp)?.label ?? "unknown key", owner: by.get(fp)?.owner ?? null }));
}

/** The unlocked keys of this actor. Using them keeps them unlocked. */
export const heldKeys = (ctx: Ctx, actor: Actor): Held[] => ctx.keys.heldBy(actor.id);

/** Decrypted notes the actor can read right now. Empty when nothing is unlocked. */
export async function privateNotes(ctx: Ctx, actor: Actor): Promise<PrivateNote[]> {
  const held = heldKeys(ctx, actor);
  return held.length ? ctx.priv.notesFor(held) : [];
}

export type LockReason = "locked" | "not-recipient" | "no-key";

/** Why the text of a private note cannot be shown to this actor: either they have not unlocked a key, or they have none that fits. */
export async function lockReason(ctx: Ctx, actor: Actor, fps: string[]): Promise<{ code: LockReason; keys: string[] }> {
  const mine = (await ctx.sys.keysOf(actor.id)).map((k) => k.fp);
  const fits = mine.filter((fp) => fps.includes(fp));
  if (fits.length) return { code: "locked", keys: fits };
  return { code: mine.length ? "not-recipient" : "no-key", keys: [] };
}

export const lockedError = (code: LockReason, keys: string[]) =>
  new HttpError(423, code === "locked" ? "this note is private: unlock your key to read it" : code === "no-key" ? "this note is private and you have no key" : "this note is private and you are not one of its recipients", { code, keys });

/**
 * The plaintext of an encrypted file, for an actor who has unlocked a key that is a recipient.
 * Throws 423 with a precise reason when they cannot.
 */
export async function openPrivate(ctx: Ctx, actor: Actor, raw: string): Promise<{ plain: string; held: Held; recipients: string[] }> {
  const header = readHeader(raw);
  const fps = header.recipients.map((r) => r.fp);
  for (const h of heldKeys(ctx, actor).filter((k) => fps.includes(k.fp))) {
    try {
      return { plain: decryptNote(raw, h.key, h.fp), held: h, recipients: fps };
    } catch (e) {
      if (!(e instanceof DecryptError)) throw e;
      if (e.code === "tampered" || e.code === "malformed") throw new HttpError(422, "the encrypted note is damaged or was modified outside Defluance", { code: e.code });
    }
  }
  const why = await lockReason(ctx, actor, fps);
  throw lockedError(why.code, why.keys);
}

/** The file of a private note on disk, opened. */
export async function readPrivate(ctx: Ctx, actor: Actor, note: NoteRow) {
  const raw = await readFile(join(ctx.root, note.path), "utf8");
  return { raw, ...(await openPrivate(ctx, actor, raw)) };
}

/** Public keys for fingerprints, from the vault keyring. A note cannot be encrypted for a key nobody published. */
export async function recipientsFor(ctx: Ctx, fps: string[]): Promise<Recipient[]> {
  const { recipients, missing } = resolveRecipients(await readKeyring(ctx.root), fps);
  if (missing.length) throw new HttpError(409, "some recipients have no public key in the vault keyring", { missing });
  return recipients;
}

/** Who a new private note is for: the author's own keys, plus any the author names. */
export async function defaultRecipients(ctx: Ctx, actor: Actor, extra: string[] = []): Promise<Recipient[]> {
  const own = await ctx.keys.recipientsOf(actor.id);
  if (!own.length && !extra.length) throw new HttpError(422, "create a key first: a private note must have at least one recipient");
  const fps = [...new Set([...own.map((r) => r.fp), ...extra])];
  return recipientsFor(ctx, fps);
}
