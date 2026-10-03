import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ConflictError, type Diagnostic, type Recipient, addFrontmatterLink, addRecipient, bodyOf, encryptNote, parseNote, pushToOrigin, readAt, removeRecipient, renderTemplate, reposOf, setFrontmatterField, slugify, spaceOf, validateFields, writeAndCommit } from "@defluance/vault-core";
import { type NoteRow } from "@defluance/indexer";
import { type Actor, can } from "../auth.js";
import { type Ctx, indexAfterWrite } from "../context.js";
import { HttpError, forbidden, notFound } from "../errors.js";
import { defaultRecipients, isPrivateRow, openPrivate, readPrivate, recipientsFor, recipientsOfRow } from "./private.js";
import { audit, authorOf, requireNote, safeId } from "./shared.js";

// ---------------------------------------------------------------- writing

export type Mode = "direct" | "branch";

export async function writeMode(ctx: Ctx, actor: Actor, requested?: Mode): Promise<Mode> {
  if (requested === "branch") return "branch";
  // Agents never write to the working branch unless the vault explicitly allows it.
  if (actor.agent && (await ctx.getConfig()).agentWriteMode === "branch") return "branch";
  return "direct";
}

export const branchFor = (actor: Actor, id: string) => `defluance/${slugify(actor.name) || "agent"}/${id.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;

const AGENT_FORBIDDEN_STATUS = new Set(["approved", "implemented"]);

export function checkStatusRule(actor: Actor, before: string | null, after: unknown) {
  if (actor.agent && typeof after === "string" && after !== before && AGENT_FORBIDDEN_STATUS.has(after)) {
    throw forbidden(`agents cannot set status "${after}": a person must approve`);
  }
}

export async function currentRaw(ctx: Ctx, path: string, branch: string | null): Promise<string> {
  if (branch) {
    try {
      return await readAt(ctx.root, path, branch);
    } catch {
      // branch does not exist yet, or the note is not on it: fall through to the working tree
    }
  }
  try {
    return await readFile(join(ctx.root, path), "utf8");
  } catch {
    throw notFound("note");
  }
}

export interface WriteResult {
  id: string;
  commit: string;
  branch: string | null;
  diagnostics: Diagnostic[];
}

export async function commit(
  ctx: Ctx,
  actor: Actor,
  p: { id: string; content: string; message: string; action: string; create: boolean; baseCommit?: string | undefined; mode?: Mode | undefined; extra?: Record<string, unknown>; encryptFor?: Recipient[] | undefined },
): Promise<WriteResult> {
  const id = safeId(p.id);
  const path = `${id}.md`;
  const config = await ctx.getConfig();
  const space = spaceOf(config, id);
  if (!can(actor, "write", space)) throw forbidden(`requires "write" on space "${space}"`);

  const note = parseNote(path, p.content, { linkTypes: (await ctx.getSchema()).linkTypes });
  const fields = validateFields(note, await ctx.getSchema());
  const errors = fields.filter((d) => d.severity === "error");
  if (errors.length) throw new HttpError(422, "note does not match the vault schema", { errors });

  const existing = await ctx.store.getNote(id);
  if (p.create && existing) throw new HttpError(409, `note "${id}" already exists`);
  if (!p.create && !existing) throw notFound("note");
  if (p.create && actor.agent && note.frontmatter["status"] !== "draft") throw forbidden("agents can only create drafts");
  if (!p.create) checkStatusRule(actor, existing?.status ?? null, note.frontmatter["status"]);

  // The text was validated as written; what reaches the disk is the encrypted file when the note is private.
  const file = p.encryptFor ? encryptNote(p.content, p.encryptFor) : p.content;
  return persist(ctx, actor, { id, path, file, message: p.message, action: p.action, baseCommit: p.baseCommit, mode: p.mode, ...(p.extra ? { extra: p.extra } : {}), diagnostics: fields });
}

/** Write a file, index it, push it and audit it. The caller has already checked rights and, for plain notes, the schema. */
async function persist(
  ctx: Ctx,
  actor: Actor,
  p: { id: string; path: string; file: string; message: string; action: string; baseCommit?: string | undefined; mode?: Mode | undefined; extra?: Record<string, unknown>; diagnostics: Diagnostic[] },
): Promise<WriteResult> {
  const { id, path } = p;
  const config = await ctx.getConfig();
  const mode = await writeMode(ctx, actor, p.mode);
  const branch = mode === "branch" ? branchFor(actor, id) : null;
  try {
    const r = await writeAndCommit(ctx.root, path, p.file, {
      message: p.message,
      author: authorOf(actor),
      ...(p.baseCommit ? { baseCommit: p.baseCommit } : {}),
      ...(branch ? { branch } : {}),
    });
    if (!branch) {
      await indexAfterWrite(ctx, [path]);
      ctx.collab.noteWritten(id, r.commit, actor.name, p.file);
    }
    if (config.vaultPush) await pushToOrigin(ctx.root, branch ?? "HEAD").catch((e: unknown) => ctx.log({ msg: "push failed", error: String(e) }));
    await audit(ctx, actor, p.action, id, { branch, message: p.message, ...p.extra }, r.commit);
    return { id, commit: r.commit, branch, diagnostics: p.diagnostics };
  } catch (e) {
    if (e instanceof ConflictError) throw new HttpError(409, "note changed since you loaded it", { current: e.actual, expected: e.expected });
    throw e;
  }
}

export interface CreateInput {
  id?: string | undefined;
  /** Full markdown including frontmatter. */
  content?: string | undefined;
  /** Alternative to `content`: build from the vault template. */
  type?: string | undefined;
  title?: string | undefined;
  body?: string | undefined;
  frontmatter?: Record<string, string> | undefined;
  message?: string | undefined;
  mode?: Mode | undefined;
  /** Encrypt the note. By default for the author's own keys. */
  private?: boolean | undefined;
  /** Extra recipients, as fingerprints from the vault keyring. Implies `private`. */
  recipients?: string[] | undefined;
}

export async function createNote(ctx: Ctx, actor: Actor, input: CreateInput): Promise<WriteResult> {
  let content = input.content;
  let id = input.id;
  if (content === undefined) {
    if (!input.type || !input.title) throw new HttpError(422, "give `content`, or `type` and `title`");
    id ??= slugify(input.title);
    if (!id) throw new HttpError(422, "title must contain letters or digits");
    let text = await renderTemplate(ctx.root, { type: input.type, title: input.title, owner: actor.name }).catch((e: Error) => {
      throw new HttpError(422, e.message);
    });
    for (const [k, v] of Object.entries(input.frontmatter ?? {})) text = setFrontmatterField(text, k, v);
    if (actor.agent) text = setFrontmatterField(text, "status", "draft");
    if (input.body) {
      const m = /^(---[\s\S]*?\n---[ \t]*\r?\n)/.exec(text);
      text = `${m?.[1] ?? ""}\n# ${input.title}\n\n${input.body.trim()}\n`;
    }
    content = text;
  }
  if (!id) throw new HttpError(422, "`id` is required with `content`");
  const encryptFor = input.private || input.recipients?.length ? await defaultRecipients(ctx, actor, input.recipients) : undefined;
  return commit(ctx, actor, { id, content, message: input.message ?? `add ${id}`, action: "note.create", create: true, mode: input.mode, encryptFor, ...(encryptFor ? { extra: { private: true } } : {}) });
}

export async function updateNote(ctx: Ctx, actor: Actor, id: string, input: { content: string; baseCommit?: string | undefined; message?: string | undefined; mode?: Mode | undefined }): Promise<WriteResult> {
  const note = await requireNote(ctx, actor, id, "write");
  // Saving a private note re-encrypts it for the same people. Only someone who can read it may do so.
  let encryptFor: Recipient[] | undefined;
  if (isPrivateRow(note)) {
    await readPrivate(ctx, actor, note);
    encryptFor = await recipientsFor(ctx, recipientsOfRow(note));
  }
  return commit(ctx, actor, { id: note.id, content: input.content, message: input.message ?? `update ${note.id}`, action: "note.update", create: false, baseCommit: input.baseCommit, mode: input.mode, encryptFor });
}

export async function setStatus(ctx: Ctx, actor: Actor, id: string, status: string, opts: { mode?: Mode | undefined; message?: string | undefined } = {}): Promise<WriteResult> {
  const note = await requireNote(ctx, actor, id, "write");
  const schema = await ctx.getSchema();
  if (!schema.statuses.includes(status)) throw new HttpError(422, `invalid status "${status}" (allowed: ${schema.statuses.join(", ")})`);
  checkStatusRule(actor, note.status, status);
  const mode = await writeMode(ctx, actor, opts.mode);
  const stored = await currentRaw(ctx, note.path, mode === "branch" ? branchFor(actor, note.id) : null);
  const { raw, encryptFor } = await plainOf(ctx, actor, note, stored);
  let content: string;
  try {
    content = setFrontmatterField(raw, "status", status);
  } catch (e) {
    throw new HttpError(422, (e as Error).message);
  }
  return commit(ctx, actor, { id: note.id, content, message: opts.message ?? `status ${note.id}: ${status}`, action: "note.status", create: false, mode: opts.mode, extra: { from: note.status, to: status }, encryptFor });
}

export async function addLink(ctx: Ctx, actor: Actor, id: string, input: { to: string; type: string; mode?: Mode | undefined }): Promise<WriteResult> {
  const note = await requireNote(ctx, actor, id, "write");
  const schema = await ctx.getSchema();
  if (!schema.linkTypes.includes(input.type)) throw new HttpError(422, `unknown link type "${input.type}" (known: ${schema.linkTypes.join(", ")})`);
  if (!/^gh:[\w.-]+\/[\w.-]+#\d+$/.test(input.to)) {
    const target = await ctx.store.getNote(safeId(input.to));
    if (!target || !can(actor, "read", target.space)) throw new HttpError(422, `target "${input.to}" not found`);
  }
  const mode = await writeMode(ctx, actor, input.mode);
  const stored = await currentRaw(ctx, note.path, mode === "branch" ? branchFor(actor, note.id) : null);
  const { raw, encryptFor } = await plainOf(ctx, actor, note, stored);
  let content: string;
  try {
    content = addFrontmatterLink(raw, input.to, input.type);
  } catch (e) {
    throw new HttpError(422, (e as Error).message);
  }
  if (content === raw) throw new HttpError(409, "link already present");
  // A private note's link target is not written to the audit log: that would say what the note is about.
  return commit(ctx, actor, { id: note.id, content, message: `link ${note.id} ${input.type}${encryptFor ? "" : ` ${input.to}`}`, action: "note.link", create: false, mode: input.mode, extra: encryptFor ? { type: input.type } : { to: input.to, type: input.type }, encryptFor });
}

/** The text to edit, and for whom to encrypt it again. A plain note is returned as it is. */
async function plainOf(ctx: Ctx, actor: Actor, note: NoteRow, stored: string): Promise<{ raw: string; encryptFor: Recipient[] | undefined }> {
  if (!isPrivateRow(note)) return { raw: stored, encryptFor: undefined };
  const opened = await openPrivate(ctx, actor, stored);
  return { raw: opened.plain, encryptFor: await recipientsFor(ctx, opened.recipients) };
}

/** Encrypt a note that is plain today. Earlier versions stay readable in git history: the answer says so. */
export async function encryptExisting(ctx: Ctx, actor: Actor, id: string, input: { recipients?: string[] | undefined } = {}) {
  const note = await requireNote(ctx, actor, id, "write");
  if (isPrivateRow(note)) throw new HttpError(409, "the note is already private");
  const raw = await currentRaw(ctx, note.path, null);
  const encryptFor = await defaultRecipients(ctx, actor, input.recipients);
  const r = await commit(ctx, actor, { id: note.id, content: raw, message: `encrypt ${note.id}`, action: "note.encrypt", create: false, mode: "direct", encryptFor, extra: { recipients: encryptFor.map((x) => x.fp) } });
  return { ...r, warning: "Earlier versions of this note stay readable in the git history. Rewrite the history, or treat their content as already shared." };
}

/** Make a private note plain again. Needs an unlocked key that is a recipient. */
export async function decryptExisting(ctx: Ctx, actor: Actor, id: string) {
  const note = await requireNote(ctx, actor, id, "write");
  if (!isPrivateRow(note)) throw new HttpError(409, "the note is not private");
  const { plain } = await readPrivate(ctx, actor, note);
  return commit(ctx, actor, { id: note.id, content: plain, message: `decrypt ${note.id}`, action: "note.decrypt", create: false, mode: "direct" });
}

/**
 * Change who can read a private note. Adding someone only wraps the note key for them. Removing someone encrypts the note
 * again under a new key for the others, but a copy they already have (git history, a backup) stays readable.
 */
export async function setRecipients(ctx: Ctx, actor: Actor, id: string, input: { add?: string[] | undefined; remove?: string[] | undefined }) {
  const note = await requireNote(ctx, actor, id, "write");
  if (!isPrivateRow(note)) throw new HttpError(409, "the note is not private");
  const { raw, held, recipients } = await readPrivate(ctx, actor, note);
  let file = raw;
  let current = recipients;
  for (const add of await recipientsFor(ctx, (input.add ?? []).filter((fp) => !current.includes(fp)))) {
    file = addRecipient(file, held.key, held.fp, add);
    current = [...current, add.fp];
  }
  const drop = (input.remove ?? []).filter((fp) => current.includes(fp));
  if (drop.length) {
    const keep = current.filter((fp) => !drop.includes(fp));
    if (!keep.length) throw new HttpError(422, "a private note must keep at least one recipient");
    if (!keep.includes(held.fp)) throw new HttpError(422, "you cannot remove the key you are using: you would lose access to the note");
    const resolved = await recipientsFor(ctx, keep);
    for (const fp of drop) file = removeRecipient(file, held.key, held.fp, fp, resolved);
    current = keep;
  }
  if (file === raw) return { id: note.id, commit: null, branch: null, recipients: current, diagnostics: [] };
  const r = await persist(ctx, actor, { id: note.id, path: note.path, file, message: `recipients ${note.id}`, action: "note.recipients", mode: "direct", extra: { add: input.add ?? [], remove: drop }, diagnostics: [] });
  return { ...r, recipients: current };
}

export async function createIssueFromNote(ctx: Ctx, actor: Actor, id: string, input: { repo?: string | undefined; title?: string | undefined; body?: string | undefined; labels?: string[] | undefined }) {
  const note = await requireNote(ctx, actor, id);
  if (!can(actor, "issues", note.space)) throw forbidden(`requires "issues" on space "${note.space}"`);
  // The issue would copy the text and title of the note to GitHub.
  if (isPrivateRow(note)) throw new HttpError(422, "a private note cannot be sent to GitHub");
  if (!ctx.github) throw new HttpError(503, "GitHub is not configured");
  const config = await ctx.getConfig();
  const allowed = reposOf(config, note.space);
  const repo = input.repo ?? allowed[0];
  if (!repo) throw new HttpError(422, `no GitHub repository configured for space "${note.space}" (.defluance/config.yaml)`);
  if (!allowed.includes(repo)) throw new HttpError(422, `repository "${repo}" is not allowed for space "${note.space}"`);

  const raw = await readFile(join(ctx.root, note.path), "utf8");
  const link = `${ctx.publicUrl}/n/${note.id.split("/").map(encodeURIComponent).join("/")}`;
  const excerpt = bodyOf(raw).replace(/^#.*\n+/, "").trim().slice(0, 1500);
  const body = input.body ?? `${excerpt}${excerpt ? "\n\n" : ""}Spec: ${link}`;
  const issue = await ctx.github.createIssue(repo, { title: input.title ?? note.title, body, ...(input.labels ? { labels: input.labels } : {}) });
  await ctx.store.upsertGhNode({
    key: issue.key, kind: "issue", state: "open", title: input.title ?? note.title, labels: input.labels ?? [], author: null,
    files: [], merged_at: null, url: issue.url, updated_at: ctx.now().toISOString(),
  });

  const link2 = await addLink(ctx, actor, note.id, { to: `gh:${issue.key}`, type: "tracked_by" }).catch((e: unknown) => {
    // The issue exists: report it even if the note could not be updated.
    return { error: e instanceof Error ? e.message : String(e) } as const;
  });
  await audit(ctx, actor, "issue.create", note.id, { key: issue.key, url: issue.url });
  return { key: issue.key, number: issue.number, url: issue.url, link: "error" in link2 ? { error: link2.error } : { commit: link2.commit, branch: link2.branch } };
}
