import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type EdgeRow, type GhNode, type NoteFilter, type NoteRow } from "@defluance/indexer";
import { bodyOf, diff, fileLog, lastCommitFor, readAt } from "@defluance/vault-core";
import { type Actor } from "../auth.js";
import { type Ctx } from "../context.js";
import { notFound } from "../errors.js";
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
}

export const summary = (n: NoteRow): NoteSummary => ({ id: n.id, title: n.title, type: n.type, status: n.status, owner: n.owner, space: n.space, tags: n.tags, updated_at: n.updated_at });

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

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export async function noteHistory(ctx: Ctx, actor: Actor, id: string, opts: { diff?: string | undefined } = {}) {
  const note = await requireNote(ctx, actor, id);
  const commits = await fileLog(ctx.root, note.path);
  if (!opts.diff) return { id: note.id, commits };
  const hash = checkRev(opts.diff);
  if (!commits.some((c) => c.hash.startsWith(hash))) throw notFound("commit");
  const patch = await diff(ctx.root, `${hash}^`, hash, note.path).catch(() => diff(ctx.root, EMPTY_TREE, hash, note.path));
  return { id: note.id, commit: hash, patch };
}
