import { type AskResult, type SmartResult, ask, deepAsk, smartSearch } from "@defluance/ai";
import {
  impact as graphImpact,
  lint as graphLint,
  neighbors as graphNeighbors,
  path as graphPath,
  search as indexSearch,
  type NoteFilter,
  type SearchMode,
} from "@defluance/indexer";
import { type Actor } from "../auth.js";
import { type Ctx } from "../context.js";
import { readSpaces, requireNote, safeId } from "./shared.js";

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
