import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, posix } from "node:path";
import { ConflictError, applyAndCommit, slugify, spaceOf } from "@defluance/vault-core";
import { type Actor, can } from "../auth.js";
import { type Ctx } from "../context.js";
import { HttpError, forbidden, notFound } from "../errors.js";
import { audit, authorOf, requireNote } from "./shared.js";

/** What can be served from the vault besides notes, with the type it is served as. */
const MEDIA: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".csv": "text/csv; charset=utf-8",
};
/** What can be uploaded: pictures and PDFs, and the first bytes must really be what the name says. */
const UPLOAD: Record<string, (b: Buffer) => boolean> = {
  ".png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ".jpg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  ".jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  ".gif": (b) => b.subarray(0, 4).toString("latin1") === "GIF8",
  ".webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  ".pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
};
export const MAX_UPLOAD = 10 * 1024 * 1024;
const MAX_SERVE = 50 * 1024 * 1024;

/** A path inside the vault that is a media file: no way out of the vault, no dotfiles (.git, .defluance), no notes. */
export function safeFilePath(raw: string): string {
  const parts = raw.split("/");
  if (!raw || raw.length > 300 || raw.includes("\\") || raw.includes("\0") || parts.some((p) => !p || p === "." || p === ".." || p.startsWith("."))) throw new HttpError(400, "invalid file path");
  if (!MEDIA[extname(raw).toLowerCase()]) throw new HttpError(415, "this kind of file is not served");
  return raw;
}

export async function readVaultFile(ctx: Ctx, actor: Actor, raw: string): Promise<{ data: Buffer; type: string; name: string }> {
  const path = safeFilePath(raw);
  const config = await ctx.getConfig();
  // 404, not 403: a file in a space the actor cannot read does not exist for them
  if (!can(actor, "read", spaceOf(config, path))) throw notFound("file");
  const abs = join(ctx.root, path);
  const info = await stat(abs).catch(() => null);
  if (!info?.isFile()) throw notFound("file");
  if (info.size > MAX_SERVE) throw new HttpError(413, "file too large");
  return { data: await readFile(abs), type: MEDIA[extname(path).toLowerCase()] as string, name: posix.basename(path) };
}

/**
 * Store a picture or PDF next to a note, in its `attachments/` folder, in one commit. The name carries a short hash of the
 * content: the same file uploaded twice is stored once, and two files with the same name do not overwrite each other.
 */
export async function uploadFile(ctx: Ctx, actor: Actor, input: { note: string; name: string; data: Buffer }) {
  const note = await requireNote(ctx, actor, input.note, "write");
  if (actor.agent) throw forbidden("agents cannot upload files");
  if (input.data.length === 0) throw new HttpError(422, "the file is empty");
  if (input.data.length > MAX_UPLOAD) throw new HttpError(413, `files are limited to ${MAX_UPLOAD / 1024 / 1024} MB`);
  const ext = extname(input.name).toLowerCase();
  const sniff = UPLOAD[ext];
  if (!sniff) throw new HttpError(415, `only ${Object.keys(UPLOAD).join(", ")} can be uploaded`);
  if (!sniff(input.data)) throw new HttpError(415, "the content of the file is not what its name says");

  const hash = createHash("sha256").update(input.data).digest("hex").slice(0, 8);
  const base = slugify(input.name.slice(0, input.name.length - ext.length)) || "file";
  const dir = dirname(note.path) === "." ? "" : dirname(note.path);
  const rel = `attachments/${base}-${hash}${ext === ".jpeg" ? ".jpg" : ext}`;
  const path = dir ? `${dir}/${rel}` : rel;
  const known = await stat(join(ctx.root, path)).then((s) => s.isFile(), () => false);
  let commit: string | null = null;
  if (!known) {
    try {
      ({ commit } = await applyAndCommit(ctx.root, { writes: [{ path, content: input.data }] }, { message: `add attachment ${posix.basename(path)}`, author: authorOf(actor) }));
    } catch (e) {
      if (e instanceof ConflictError) throw new HttpError(409, "conflict while saving the file");
      throw e;
    }
    await audit(ctx, actor, "file.upload", path, { bytes: input.data.length, note: note.id }, commit);
  }
  return { path, ref: rel, markdown: `![[${rel}]]`, commit, existed: known };
}
