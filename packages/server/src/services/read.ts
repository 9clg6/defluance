import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type EdgeRow, type GhNode, type NoteFilter, type NoteRow } from "@defluance/indexer";
import { bodyOf, diff, fileLog, lastCommitFor, parseNote, readAt } from "@defluance/vault-core";
import { type Actor } from "../auth.js";
import { type Ctx } from "../context.js";
import { HttpError, notFound } from "../errors.js";
import { isPrivateRow, keyLabels, lockReason, openPrivate, privateNotes, recipientsOfRow } from "./private.js";
import { checkRev, readSpaces, requireNote } from "./shared.js";

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
  /** The note is encrypted. Only present on private notes. */
  private?: boolean;
  /** A private note whose text this actor cannot read right now: its title is the file name. */
  locked?: boolean;
}

export const summary = (n: NoteRow): NoteSummary => ({
  id: n.id, title: n.title, type: n.type, status: n.status, owner: n.owner, space: n.space, tags: n.tags, updated_at: n.updated_at,
  ...(isPrivateRow(n) ? { private: true, locked: true } : {}),
});

/** Summaries, with the real title and tags of private notes the actor has unlocked. */
async function summaries(ctx: Ctx, actor: Actor, rows: NoteRow[]): Promise<NoteSummary[]> {
  const out = rows.map(summary);
  if (!rows.some(isPrivateRow)) return out;
  const open = new Map((await privateNotes(ctx, actor)).map((p) => [p.id, p]));
  return out.map((s) => {
    const p = open.get(s.id);
    if (!p) return s;
    const tags = p.parsed.frontmatter["tags"];
    return { ...s, locked: false, title: p.parsed.title, tags: Array.isArray(tags) ? (tags as string[]) : [] };
  });
}

export interface NoteStats {
  total: number;
  /** One row per note type, biggest first, with the number of notes in each status. */
  groups: { type: string; total: number; statuses: Record<string, number> }[];
}

export async function noteStats(ctx: Ctx, actor: Actor): Promise<NoteStats> {
  const rows = await ctx.store.stats({ spaces: await readSpaces(ctx, actor) });
  const groups = new Map<string, NoteStats["groups"][number]>();
  for (const r of rows) {
    const type = r.type ?? "untyped";
    const g = groups.get(type) ?? { type, total: 0, statuses: {} };
    const status = r.status ?? "none";
    g.statuses[status] = (g.statuses[status] ?? 0) + r.count;
    g.total += r.count;
    groups.set(type, g);
  }
  const list = [...groups.values()].sort((a, b) => b.total - a.total || a.type.localeCompare(b.type));
  return { total: list.reduce((n, g) => n + g.total, 0), groups: list };
}

export async function listNotes(ctx: Ctx, actor: Actor, f: NoteFilter & { limit?: number | undefined; after?: string | undefined; sort?: "id" | "updated" | undefined }) {
  const readable = await readSpaces(ctx, actor);
  const spaces = f.space ? (readable && !readable.includes(f.space) ? [] : undefined) : readable;
  const limit = Math.min(f.limit ?? 50, 200);
  const rows = await ctx.store.listNotes({ ...f, spaces, limit: limit + 1 });
  const page = rows.slice(0, limit);
  return { items: await summaries(ctx, actor, page), next: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
}

export async function getNote(ctx: Ctx, actor: Actor, id: string, opts: { rev?: string | undefined } = {}) {
  const note = await requireNote(ctx, actor, id);
  const raw = opts.rev ? await readAt(ctx.root, note.path, checkRev(opts.rev)).catch(() => { throw notFound("revision"); }) : await readFile(join(ctx.root, note.path), "utf8");
  if (isPrivateRow(note)) return privateNote(ctx, actor, note, raw, opts.rev ?? null);
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

/**
 * A private note: its text when the actor has unlocked a key that is a recipient, otherwise only the public header
 * and the reason it is locked. The ciphertext itself is never returned.
 */
async function privateNote(ctx: Ctx, actor: Actor, note: NoteRow, raw: string, rev: string | null) {
  const recipients = await keyLabels(ctx, recipientsOfRow(note));
  const base = { ...summary(note), path: note.path, commit: await lastCommitFor(ctx.root, note.path, rev ?? "HEAD"), rev, private: true as const, recipients };
  try {
    const { plain, held } = await openPrivate(ctx, actor, raw);
    const parsed = parseNote(note.path, plain, { linkTypes: (await ctx.getSchema()).linkTypes });
    const tags = parsed.frontmatter["tags"];
    return { ...base, title: parsed.title, tags: Array.isArray(tags) ? (tags as string[]) : [], locked: false as const, unlocked_with: held.fp, frontmatter: parsed.frontmatter, headings: parsed.headings, body: bodyOf(plain), raw: plain };
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 423) throw e;
    const why = await lockReason(ctx, actor, recipients.map((r) => r.fp));
    return { ...base, locked: true as const, reason: why.code, keys: why.keys, frontmatter: { type: note.type, status: note.status, owner: note.owner }, headings: [] as NoteRow["headings"], body: "", raw: "" };
  }
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
  // The links of a private note are not indexed; while it is unlocked they come from its decrypted text.
  const privLinks = isPrivateRow(note) ? ((await privateNotes(ctx, actor)).find((p) => p.id === note.id)?.parsed.links ?? []) : [];
  const ghKeys = [...out.filter((e) => e.kind === "github").map((e) => e.to_ref), ...privLinks.filter((l) => l.kind === "github").map((l) => l.target)].map((r) => r.replace(/^gh:/, ""));
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
  const byName = (t: string) => {
    if (g.nodes.has(t)) return g.nodes.get(t);
    const same = [...g.nodes.values()].filter((n) => n.id.split("/").at(-1) === t);
    return same.length === 1 ? same[0] : undefined;
  };
  for (const l of privLinks) {
    const t = l.kind === "note" ? byName(l.target) : undefined;
    if (t && !visible(t.id)) continue;
    outgoing.push({
      type: l.type, kind: l.kind, target: t?.id ?? l.target, heading: l.heading ?? null, line: l.line, source: l.source,
      note: t ? { id: t.id, title: t.title, type: t.type, status: t.status } : null,
      github: l.kind === "github" ? (gh.get(l.target.replace(/^gh:/, "")) ?? null) : null,
      broken: l.kind === "note" && !t,
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

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export async function noteHistory(ctx: Ctx, actor: Actor, id: string, opts: { diff?: string | undefined } = {}) {
  const note = await requireNote(ctx, actor, id);
  const commits = await fileLog(ctx.root, note.path);
  if (!opts.diff) return { id: note.id, commits };
  const hash = checkRev(opts.diff);
  if (!commits.some((c) => c.hash.startsWith(hash))) throw notFound("commit");
  // A diff of an encrypted file is a diff of base64: it says nothing, so it is not shown.
  if (isPrivateRow(note)) return { id: note.id, commit: hash, patch: "", private: true };
  const patch = await diff(ctx.root, `${hash}^`, hash, note.path).catch(() => diff(ctx.root, EMPTY_TREE, hash, note.path));
  return { id: note.id, commit: hash, patch };
}

/** Every note the actor can read, as a flat list the UI folds into a tree. Capped: a very large vault gets the first notes. */
export async function vaultTree(ctx: Ctx, actor: Actor) {
  const cap = 10_000;
  const rows = await ctx.store.listNotes({ spaces: await readSpaces(ctx, actor), limit: cap + 1 });
  return { notes: await summaries(ctx, actor, rows.slice(0, cap)), truncated: rows.length > cap };
}
