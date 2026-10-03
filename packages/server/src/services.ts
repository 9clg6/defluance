import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ask, deepAsk, smartSearch, type AskResult, type SmartResult } from "@defluance/ai";
import {
  impact as graphImpact,
  lint as graphLint,
  neighbors as graphNeighbors,
  path as graphPath,
  search as indexSearch,
  type EdgeRow,
  type GhNode,
  type NoteFilter,
  type NoteRow,
  type SearchMode,
} from "@defluance/indexer";
import {
  addFrontmatterLink,
  ConflictError,
  diff,
  fileLog,
  lastCommitFor,
  parseNote,
  pushToOrigin,
  readAt,
  renderTemplate,
  reposOf,
  setFrontmatterField,
  slugify,
  spaceOf,
  validateFields,
  writeAndCommit,
  bodyOf,
  type Author,
  type Diagnostic,
} from "@defluance/vault-core";
import { actorFromToken, can, readableSpaces, type Actor } from "./auth.js";
import { indexAfterWrite, indexNow, type Ctx } from "./context.js";
import { forbidden, HttpError, notFound } from "./errors.js";
import { PERMS, ROLES, type AuditFilter, type Perm, type Role } from "./system.js";

// ---------------------------------------------------------------- helpers

const spaceNames = async (ctx: Ctx) => ["default", ...(await ctx.getConfig()).spaces.map((s) => s.name)];

/** Spaces the actor may read. `undefined`: no restriction. */
export async function readSpaces(ctx: Ctx, actor: Actor): Promise<string[] | undefined> {
  return readableSpaces(actor, await spaceNames(ctx));
}

const authorOf = (a: Actor): Author => ({ name: a.name, email: `${a.id}@defluance.local` });

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
const checkRev = (rev: string) => {
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

// ---------------------------------------------------------------- reading

export interface NoteSummary {
  id: string;
  title: string;
  type: string | null;
  status: string | null;
  owner: string | null;
  space: string;
  tags: string[];
  updated_at: string;
}

const summary = (n: NoteRow): NoteSummary => ({ id: n.id, title: n.title, type: n.type, status: n.status, owner: n.owner, space: n.space, tags: n.tags, updated_at: n.updated_at });

export async function listNotes(ctx: Ctx, actor: Actor, f: NoteFilter & { limit?: number | undefined; after?: string | undefined; sort?: "id" | "updated" | undefined }) {
  const readable = await readSpaces(ctx, actor);
  const spaces = f.space ? (readable && !readable.includes(f.space) ? [] : undefined) : readable;
  const limit = Math.min(f.limit ?? 50, 200);
  const rows = await ctx.store.listNotes({ ...f, spaces, limit: limit + 1 });
  const page = rows.slice(0, limit);
  return { items: page.map(summary), next: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
}

export async function getNote(ctx: Ctx, actor: Actor, id: string, opts: { rev?: string | undefined } = {}) {
  const note = await requireNote(ctx, actor, id);
  const raw = opts.rev ? await readAt(ctx.root, note.path, checkRev(opts.rev)).catch(() => { throw notFound("revision"); }) : await readFile(join(ctx.root, note.path), "utf8");
  return {
    ...summary(note),
    path: note.path,
    frontmatter: note.frontmatter,
    headings: note.headings,
    body: bodyOf(raw),
    raw,
    commit: await lastCommitFor(ctx.root, note.path, opts.rev ?? "HEAD"),
    rev: opts.rev ?? null,
  };
}

export interface LinkView {
  type: string;
  kind: "note" | "github";
  target: string;
  heading: string | null;
  line: number;
  source: string;
  note: { id: string; title: string; type: string | null; status: string | null } | null;
  github: GhNode | null;
  broken: boolean;
}

export async function noteLinks(ctx: Ctx, actor: Actor, id: string) {
  const note = await requireNote(ctx, actor, id);
  const g = await ctx.store.graph();
  const readable = await readSpaces(ctx, actor);
  const visible = (nid: string) => {
    const n = g.nodes.get(nid);
    return !!n && (!readable || readable.includes(n.space));
  };
  const out = await ctx.store.edgesFrom(note.id);
  const ghKeys = out.filter((e) => e.kind === "github").map((e) => e.to_ref.replace(/^gh:/, ""));
  const gh = new Map((await ctx.store.ghNodes(ghKeys)).map((n) => [n.key, n]));

  const outgoing: LinkView[] = [];
  const seenOut = new Set<string>();
  for (const e of out) {
    if (e.to_note && !visible(e.to_note)) continue;
    // the same link written in the frontmatter and in the body counts once
    const key = `${e.link_type}|${e.to_ref}|${e.heading ?? ""}`;
    if (seenOut.has(key)) continue;
    seenOut.add(key);
    const t = e.to_note ? g.nodes.get(e.to_note) : undefined;
    outgoing.push({
      type: e.link_type,
      kind: e.kind,
      target: e.to_ref,
      heading: e.heading,
      line: e.line,
      source: e.source,
      note: t ? { id: t.id, title: t.title, type: t.type, status: t.status } : null,
      github: e.kind === "github" ? (gh.get(e.to_ref.replace(/^gh:/, "")) ?? null) : null,
      broken: e.kind === "note" && !e.to_note,
    });
  }
  const seenIn = new Set<string>();
  const incoming = (await ctx.store.edgesTo(note.id))
    .filter((e: EdgeRow) => visible(e.from_note))
    .filter((e: EdgeRow) => {
      const key = `${e.link_type}|${e.from_note}`;
      if (seenIn.has(key)) return false;
      seenIn.add(key);
      return true;
    })
    .map((e: EdgeRow) => {
      const f = g.nodes.get(e.from_note);
      return { type: e.link_type, line: e.line, from: { id: e.from_note, title: f?.title ?? e.from_note, type: f?.type ?? null, status: f?.status ?? null } };
    });
  const group = <T extends { type: string }>(items: T[]) => {
    const by: Record<string, T[]> = {};
    for (const i of items) (by[i.type] ??= []).push(i);
    return by;
  };
  return { id: note.id, outgoing: group(outgoing), incoming: group(incoming) };
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export async function noteHistory(ctx: Ctx, actor: Actor, id: string, opts: { diff?: string | undefined } = {}) {
  const note = await requireNote(ctx, actor, id);
  const commits = await fileLog(ctx.root, note.path);
  if (!opts.diff) return { id: note.id, commits };
  const hash = checkRev(opts.diff);
  if (!commits.some((c) => c.hash.startsWith(hash))) throw notFound("commit");
  const patch = await diff(ctx.root, `${hash}^`, hash, note.path).catch(() => diff(ctx.root, EMPTY_TREE, hash, note.path));
  return { id: note.id, commit: hash, patch };
}

export async function searchNotes(ctx: Ctx, actor: Actor, q: string, f: NoteFilter & { limit?: number | undefined; mode?: SearchMode | undefined; passages?: number | undefined }) {
  const readable = await readSpaces(ctx, actor);
  const spaces = f.space ? (readable && !readable.includes(f.space) ? [] : undefined) : readable;
  return indexSearch(ctx.store, q, { ...f, spaces, embedder: ctx.embedder, limit: Math.min(f.limit ?? 20, 50) });
}

/** Search with the language model in front: reformulations, inferred filters, optional reranking. Plain hybrid without a model. */
export async function smartSearchNotes(ctx: Ctx, actor: Actor, q: string, f: NoteFilter & { limit?: number | undefined; passages?: number | undefined; rerank?: boolean | undefined }): Promise<SmartResult> {
  const readable = await readSpaces(ctx, actor);
  const spaces = f.space ? (readable && !readable.includes(f.space) ? [] : undefined) : readable;
  const schema = await ctx.getSchema();
  return smartSearch(ctx.store, q, {
    ...f,
    spaces,
    embedder: ctx.embedder,
    llm: ctx.llm,
    limit: Math.min(f.limit ?? 10, 30),
    vocabulary: { types: Object.keys(schema.types).filter((t) => t !== "issue" && t !== "pull-request"), statuses: schema.statuses },
  });
}

export async function askQuestion(ctx: Ctx, actor: Actor, question: string, f: NoteFilter & { scopeNote?: string | undefined; scopeDepth?: number | undefined; deep?: boolean | undefined; maxSteps?: number | undefined } = {}): Promise<AskResult> {
  const readable = await readSpaces(ctx, actor);
  const spaces = f.space ? (readable && !readable.includes(f.space) ? [] : undefined) : readable;
  const { scopeNote, scopeDepth, deep, maxSteps, ...filter } = f;
  // "Ask about this note": retrieval is limited to the note and the notes within `scopeDepth` links of it.
  const ids = scopeNote ? (await graphNeighborsOf(ctx, actor, scopeNote, { depth: scopeDepth ?? 1 })).nodes.map((n) => n.id) : undefined;
  const opts = { ...filter, spaces, ids, embedder: ctx.embedder, llm: ctx.llm };
  return deep ? deepAsk(ctx.store, question, { ...opts, ...(maxSteps ? { maxSteps } : {}) }) : ask(ctx.store, question, opts);
}

export async function vaultSchema(ctx: Ctx) {
  const s = await ctx.getSchema();
  return { types: s.types, statuses: s.statuses, linkTypes: s.linkTypes };
}

export async function graphNeighborsOf(ctx: Ctx, actor: Actor, id: string, o: { link?: string | undefined; direction?: "in" | "out" | "both" | undefined; depth?: number | undefined }) {
  await requireNote(ctx, actor, id);
  return graphNeighbors(ctx.store, safeId(id), { ...o, spaces: await readSpaces(ctx, actor) });
}

export async function graphPathOf(ctx: Ctx, actor: Actor, from: string, to: string, maxDepth?: number) {
  await requireNote(ctx, actor, from);
  await requireNote(ctx, actor, to);
  return graphPath(ctx.store, safeId(from), safeId(to), { spaces: await readSpaces(ctx, actor), ...(maxDepth ? { maxDepth } : {}) });
}

export async function graphImpactOf(ctx: Ctx, actor: Actor, id: string, depth?: number) {
  await requireNote(ctx, actor, id);
  return graphImpact(ctx.store, safeId(id), { spaces: await readSpaces(ctx, actor), depth });
}

export async function graphLintOf(ctx: Ctx, actor: Actor) {
  return graphLint(ctx.store, { spaces: await readSpaces(ctx, actor) });
}

/** The whole readable graph, for the global graph view. Capped. */
export async function graphOverview(ctx: Ctx, actor: Actor, limit = 300) {
  const g = await ctx.store.graph();
  const readable = await readSpaces(ctx, actor);
  const ok = (id: string) => {
    const n = g.nodes.get(id);
    return !!n && (!readable || readable.includes(n.space));
  };
  const degree = new Map<string, number>();
  for (const e of g.edges) {
    if (!e.to_note || !ok(e.from_note) || !ok(e.to_note)) continue;
    degree.set(e.from_note, (degree.get(e.from_note) ?? 0) + 1);
    degree.set(e.to_note, (degree.get(e.to_note) ?? 0) + 1);
  }
  const ids = [...g.nodes.keys()].filter(ok).sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b));
  const keep = new Set(ids.slice(0, limit));
  return {
    nodes: [...keep].map((id) => {
      const n = g.nodes.get(id);
      return { id, title: n?.title ?? id, type: n?.type ?? null, status: n?.status ?? null, depth: 0 };
    }),
    edges: g.edges.filter((e) => e.to_note && keep.has(e.from_note) && keep.has(e.to_note)).map((e) => ({ from: e.from_note, to: e.to_note as string, type: e.link_type })),
    truncated: ids.length > keep.size,
  };
}

// ---------------------------------------------------------------- writing

type Mode = "direct" | "branch";

async function writeMode(ctx: Ctx, actor: Actor, requested?: Mode): Promise<Mode> {
  if (requested === "branch") return "branch";
  // Agents never write to the working branch unless the vault explicitly allows it.
  if (actor.agent && (await ctx.getConfig()).agentWriteMode === "branch") return "branch";
  return "direct";
}

const branchFor = (actor: Actor, id: string) => `defluance/${slugify(actor.name) || "agent"}/${id.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;

const AGENT_FORBIDDEN_STATUS = new Set(["approved", "implemented"]);

function checkStatusRule(actor: Actor, before: string | null, after: unknown) {
  if (actor.agent && typeof after === "string" && after !== before && AGENT_FORBIDDEN_STATUS.has(after)) {
    throw forbidden(`agents cannot set status "${after}": a person must approve`);
  }
}

async function currentRaw(ctx: Ctx, path: string, branch: string | null): Promise<string> {
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

async function commit(
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

const isGlobalAdmin = (actor: Actor) => can(actor, "admin", "*");
export const isAdmin = isGlobalAdmin;

/** Spaces a token covers, `[]` meaning all. The actor must hold admin on each. */
async function checkTokenSpaces(ctx: Ctx, actor: Actor, spaces: string[]) {
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

export async function createToken(ctx: Ctx, actor: Actor, input: { name: string; scopes: Perm[]; spaces: string[]; expiresInDays?: number | undefined }) {
  await checkTokenSpaces(ctx, actor, input.spaces);
  const targets = input.spaces.length ? input.spaces : ["*"];
  for (const sc of input.scopes) for (const s of targets) if (!can(actor, sc, s)) throw forbidden(`you cannot grant "${sc}" on "${s}"`);
  if (!input.scopes.every((s) => PERMS.includes(s)) || input.scopes.length === 0) throw new HttpError(422, "scopes must be a non-empty subset of read, write, issues, admin");
  const { token, row } = await ctx.sys.createToken({ name: input.name, scopes: input.scopes, spaces: input.spaces, createdBy: actor.name, ...(input.expiresInDays ? { expiresInDays: input.expiresInDays } : {}) });
  await audit(ctx, actor, "token.create", row.id, { name: row.name, scopes: row.scopes, spaces: row.spaces });
  return { token, ...row };
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
  };
}

export async function me(ctx: Ctx, actor: Actor) {
  return { kind: actor.kind, id: actor.id, name: actor.name, spaces: await listSpaces(ctx, actor), oauth: !!ctx.oauth, local: ctx.localMode, capabilities: capabilities(ctx) };
}

export { actorFromToken };

// ---------------------------------------------------------------- pull request impact

/** `*` matches inside a folder, `**` across folders, `?` one character. A pattern with no wildcard is a path prefix. */
export function globMatch(pattern: string, file: string): boolean {
  const p = pattern.replace(/^\.?\//, "");
  if (!/[*?]/.test(p)) return file === p || file.startsWith(p.replace(/\/?$/, "/"));
  const re = p
    .split(/(\*\*\/?|\*|\?)/)
    .map((t) => (t === "**/" ? "(?:.*/)?" : t === "**" ? ".*" : t === "*" ? "[^/]*" : t === "?" ? "[^/]" : t.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${re}$`).test(file);
}

export interface PrImpact {
  pr: string;
  state: string | null;
  files: number;
  /** Notes tied to the PR directly. */
  seeds: { id: string; reason: string }[];
  /** Notes reached through depends_on / implements / tested_by from the seeds. */
  impacted: { id: string; title: string; via: string }[];
}

export async function impactOfPullRequest(ctx: Ctx, actor: Actor, key: string): Promise<PrImpact> {
  const node = await ctx.store.ghNode(key);
  if (!node) throw notFound("pull request (is the GitHub connector synced?)");
  const readable = await readSpaces(ctx, actor);
  const ok = (n: { space: string }) => !readable || readable.includes(n.space);

  const seeds = new Map<string, string>();
  for (const { note, link_type } of await ctx.store.notesLinkingToGh(key)) {
    if (ok(note) && link_type === "tracked_by") seeds.set(note.id, "tracked_by");
  }
  for (const n of await ctx.store.listNotes({ type: "component", limit: 200 })) {
    if (!ok(n)) continue;
    const paths = Array.isArray(n.frontmatter["paths"]) ? (n.frontmatter["paths"] as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const hit = paths.find((pat) => node.files.some((f) => globMatch(pat, f)));
    if (hit && !seeds.has(n.id)) seeds.set(n.id, `paths: ${hit}`);
  }
  const impacted = new Map<string, { id: string; title: string; via: string }>();
  for (const id of seeds.keys()) {
    for (const r of (await graphImpact(ctx.store, id, { spaces: readable, depth: 3 })).notes) {
      if (!seeds.has(r.id) && !impacted.has(r.id)) impacted.set(r.id, { id: r.id, title: r.title, via: r.via });
    }
  }
  return {
    pr: key,
    state: node.state,
    files: node.files.length,
    seeds: [...seeds].map(([id, reason]) => ({ id, reason })),
    impacted: [...impacted.values()],
  };
}
