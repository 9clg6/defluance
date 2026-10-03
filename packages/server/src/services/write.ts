import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ConflictError, type Diagnostic, addFrontmatterLink, bodyOf, parseNote, pushToOrigin, readAt, renderTemplate, reposOf, setFrontmatterField, slugify, spaceOf, validateFields, writeAndCommit } from "@defluance/vault-core";
import { type Actor, can } from "../auth.js";
import { type Ctx, indexAfterWrite } from "../context.js";
import { HttpError, forbidden, notFound } from "../errors.js";
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
  p: { id: string; content: string; message: string; action: string; create: boolean; baseCommit?: string | undefined; mode?: Mode | undefined; extra?: Record<string, unknown> },
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

  const mode = await writeMode(ctx, actor, p.mode);
  const branch = mode === "branch" ? branchFor(actor, id) : null;
  try {
    const r = await writeAndCommit(ctx.root, path, p.content, {
      message: p.message,
      author: authorOf(actor),
      ...(p.baseCommit ? { baseCommit: p.baseCommit } : {}),
      ...(branch ? { branch } : {}),
    });
    if (!branch) await indexAfterWrite(ctx, [path]);
    if (config.vaultPush) await pushToOrigin(ctx.root, branch ?? "HEAD").catch((e: unknown) => ctx.log({ msg: "push failed", error: String(e) }));
    await audit(ctx, actor, p.action, id, { branch, message: p.message, ...p.extra }, r.commit);
    return { id, commit: r.commit, branch, diagnostics: fields };
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
  return commit(ctx, actor, { id, content, message: input.message ?? `add ${id}`, action: "note.create", create: true, mode: input.mode });
}

export async function updateNote(ctx: Ctx, actor: Actor, id: string, input: { content: string; baseCommit?: string | undefined; message?: string | undefined; mode?: Mode | undefined }): Promise<WriteResult> {
  const note = await requireNote(ctx, actor, id, "write");
  return commit(ctx, actor, { id: note.id, content: input.content, message: input.message ?? `update ${note.id}`, action: "note.update", create: false, baseCommit: input.baseCommit, mode: input.mode });
}

export async function setStatus(ctx: Ctx, actor: Actor, id: string, status: string, opts: { mode?: Mode | undefined; message?: string | undefined } = {}): Promise<WriteResult> {
  const note = await requireNote(ctx, actor, id, "write");
  const schema = await ctx.getSchema();
  if (!schema.statuses.includes(status)) throw new HttpError(422, `invalid status "${status}" (allowed: ${schema.statuses.join(", ")})`);
  checkStatusRule(actor, note.status, status);
  const mode = await writeMode(ctx, actor, opts.mode);
  const raw = await currentRaw(ctx, note.path, mode === "branch" ? branchFor(actor, note.id) : null);
  let content: string;
  try {
    content = setFrontmatterField(raw, "status", status);
  } catch (e) {
    throw new HttpError(422, (e as Error).message);
  }
  return commit(ctx, actor, { id: note.id, content, message: opts.message ?? `status ${note.id}: ${status}`, action: "note.status", create: false, mode: opts.mode, extra: { from: note.status, to: status } });
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
  const raw = await currentRaw(ctx, note.path, mode === "branch" ? branchFor(actor, note.id) : null);
  let content: string;
  try {
    content = addFrontmatterLink(raw, input.to, input.type);
  } catch (e) {
    throw new HttpError(422, (e as Error).message);
  }
  if (content === raw) throw new HttpError(409, "link already present");
  return commit(ctx, actor, { id: note.id, content, message: `link ${note.id} ${input.type} ${input.to}`, action: "note.link", create: false, mode: input.mode, extra: { to: input.to, type: input.type } });
}

export async function createIssueFromNote(ctx: Ctx, actor: Actor, id: string, input: { repo?: string | undefined; title?: string | undefined; body?: string | undefined; labels?: string[] | undefined }) {
  const note = await requireNote(ctx, actor, id);
  if (!can(actor, "issues", note.space)) throw forbidden(`requires "issues" on space "${note.space}"`);
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
