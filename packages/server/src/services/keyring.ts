import { readKeyring } from "@defluance/vault-core";
import { type Actor } from "../auth.js";
import { type Ctx } from "../context.js";
import { HttpError, forbidden } from "../errors.js";
import { audit, authorOf } from "./shared.js";

/** Your keys, which are unlocked, and every public key people can encrypt for. */
export async function listKeys(ctx: Ctx, actor: Actor) {
  const keyring = (await readKeyring(ctx.root)).map((e) => ({ fp: e.fp, label: e.label, owner: e.owner, created: e.created }));
  return { mine: await ctx.keys.statusFor(actor.id), keyring };
}

export async function createKey(ctx: Ctx, actor: Actor, input: { label: string; passphrase: string }) {
  // A key made for a program is made with its token (see createToken); a person makes their own.
  if (actor.agent) throw forbidden("agents get their key when their token is created");
  const row = await ctx.keys.create({ kind: actor.kind, id: actor.id }, { label: input.label, passphrase: input.passphrase, bound: "passphrase", author: authorOf(actor) });
  await audit(ctx, actor, "key.create", row.fp, { label: row.label });
  return { fp: row.fp, label: row.label, bound: row.bound, created_at: row.created_at };
}

export async function unlockKey(ctx: Ctx, actor: Actor, fp: string, passphrase: string) {
  try {
    const status = await ctx.keys.unlock(actor.id, fp, passphrase);
    await audit(ctx, actor, "key.unlock", fp);
    return status;
  } catch (e) {
    // Wrong guesses are part of the record; the passphrase itself never is.
    if (e instanceof HttpError && (e.status === 401 || e.status === 429)) await audit(ctx, actor, "key.unlock.failed", fp, { status: e.status });
    throw e;
  }
}

export async function lockKeys(ctx: Ctx, actor: Actor, fp?: string) {
  ctx.keys.lock(actor.id, fp);
  // The decrypted notes of a key are dropped with it, unless another unlocked key still opens them.
  if (fp) ctx.priv.drop(fp);
  else ctx.priv.dropAll();
  await audit(ctx, actor, "key.lock", fp ?? null);
  return { ok: true };
}

/** The passphrase-protected private key, to keep as a backup. Useless without the passphrase. */
export async function backupKey(ctx: Ctx, actor: Actor, fp: string) {
  const row = await ctx.sys.getKey(fp);
  if (!row || row.owner_id !== actor.id) throw new HttpError(404, "key not found");
  await audit(ctx, actor, "key.backup", fp);
  return { fp: row.fp, label: row.label, public_pem: row.public_pem, protected: JSON.parse(row.protected) as unknown };
}

export async function deleteKey(ctx: Ctx, actor: Actor, fp: string) {
  await ctx.keys.delete(actor.id, fp);
  ctx.priv.drop(fp);
  await audit(ctx, actor, "key.delete", fp);
  return { ok: true };
}
