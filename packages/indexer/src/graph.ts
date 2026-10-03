import type { EdgeRow, GhNode, GraphData, IndexStore } from "./store.js";

export type Direction = "in" | "out" | "both";

export interface GraphNode {
  id: string;
  title: string;
  type: string | null;
  status: string | null;
  depth: number;
}
export interface GraphEdge {
  from: string;
  to: string;
  type: string;
}

export interface Subgraph {
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface GraphOptions {
  /** Hide notes outside these spaces. */
  spaces?: string[] | undefined;
}

export const MAX_NODES = 500;
export const MAX_DEPTH = 5;

const visible = (g: GraphData, id: string, o: GraphOptions) => {
  const n = g.nodes.get(id);
  return !!n && (!o.spaces || o.spaces.includes(n.space));
};

const node = (g: GraphData, id: string, depth: number): GraphNode => {
  const n = g.nodes.get(id);
  return { id, title: n?.title ?? id, type: n?.type ?? null, status: n?.status ?? null, depth };
};

/** Resolved note-to-note edges leaving `id`, then entering it, according to direction. */
function step(g: GraphData, id: string, dir: Direction, link?: string): { next: string; edge: EdgeRow }[] {
  const out: { next: string; edge: EdgeRow }[] = [];
  if (dir !== "in") for (const e of g.out.get(id) ?? []) if (e.to_note && (!link || e.link_type === link)) out.push({ next: e.to_note, edge: e });
  if (dir !== "out") for (const e of g.in.get(id) ?? []) if (!link || e.link_type === link) out.push({ next: e.from_note, edge: e });
  return out;
}

function induced(g: GraphData, ids: Set<string>, link?: string): GraphEdge[] {
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const id of ids) {
    for (const e of g.out.get(id) ?? []) {
      if (!e.to_note || !ids.has(e.to_note) || (link && e.link_type !== link)) continue;
      const k = `${e.from_note}|${e.to_note}|${e.link_type}`;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({ from: e.from_note, to: e.to_note, type: e.link_type });
    }
  }
  return edges;
}

export async function neighbors(
  store: IndexStore,
  id: string,
  opts: GraphOptions & { link?: string | undefined; direction?: Direction | undefined; depth?: number | undefined } = {},
): Promise<Subgraph> {
  const g = await store.graph();
  const depth = Math.min(Math.max(opts.depth ?? 1, 1), MAX_DEPTH);
  const dir = opts.direction ?? "both";
  const seen = new Map<string, number>([[id, 0]]);
  let frontier = [id];
  let truncated = false;
  for (let d = 1; d <= depth && frontier.length; d++) {
    const nextFrontier: string[] = [];
    for (const cur of frontier) {
      for (const { next } of step(g, cur, dir, opts.link)) {
        if (seen.has(next) || !visible(g, next, opts)) continue;
        if (seen.size >= MAX_NODES) {
          truncated = true;
          continue;
        }
        seen.set(next, d);
        nextFrontier.push(next);
      }
    }
    frontier = nextFrontier;
  }
  const ids = new Set(seen.keys());
  return { root: id, nodes: [...seen].map(([n, d]) => node(g, n, d)), edges: induced(g, ids, opts.link), truncated };
}

/** Shortest undirected path between two notes. */
export async function path(
  store: IndexStore,
  from: string,
  to: string,
  opts: GraphOptions & { maxDepth?: number } = {},
): Promise<{ found: boolean; nodes: GraphNode[]; edges: GraphEdge[] }> {
  const g = await store.graph();
  const max = Math.min(opts.maxDepth ?? 6, 10);
  if (!visible(g, from, opts) || !visible(g, to, opts)) return { found: false, nodes: [], edges: [] };
  const prev = new Map<string, { from: string; edge: EdgeRow } | null>([[from, null]]);
  let frontier = [from];
  for (let d = 0; d < max && frontier.length && !prev.has(to); d++) {
    const nf: string[] = [];
    for (const cur of frontier) {
      for (const { next, edge } of step(g, cur, "both")) {
        if (prev.has(next) || !visible(g, next, opts)) continue;
        prev.set(next, { from: cur, edge });
        nf.push(next);
      }
    }
    frontier = nf;
  }
  if (!prev.has(to)) return { found: false, nodes: [], edges: [] };
  const ids: string[] = [];
  const edges: GraphEdge[] = [];
  for (let cur: string | undefined = to; cur; ) {
    ids.unshift(cur);
    const p: { from: string; edge: EdgeRow } | null | undefined = prev.get(cur);
    if (p) edges.unshift({ from: p.edge.from_note, to: p.edge.to_note as string, type: p.edge.link_type });
    cur = p?.from;
  }
  return { found: true, nodes: ids.map((n, i) => node(g, n, i)), edges };
}

/** If note B changes: notes that depend on or implement B, and tests of those, are impacted. */
const IMPACT_IN = new Set(["depends_on", "implements"]);
const IMPACT_OUT = new Set(["tested_by"]);

export interface ImpactResult {
  root: string;
  notes: (GraphNode & { via: string; linkType: string })[];
  edges: GraphEdge[];
  /** GitHub objects tracking the root or any impacted note. */
  github: { key: string; node: GhNode | null; notes: string[] }[];
  truncated: boolean;
}

export async function impact(
  store: IndexStore,
  id: string,
  opts: GraphOptions & { depth?: number | undefined } = {},
): Promise<ImpactResult> {
  const g = await store.graph();
  const depth = Math.min(Math.max(opts.depth ?? 5, 1), MAX_DEPTH);
  const seen = new Map<string, { depth: number; via: string; linkType: string }>([[id, { depth: 0, via: id, linkType: "" }]]);
  let frontier = [id];
  let truncated = false;
  for (let d = 1; d <= depth && frontier.length; d++) {
    const nf: string[] = [];
    for (const cur of frontier) {
      const candidates: { next: string; type: string }[] = [];
      for (const e of g.in.get(cur) ?? []) if (IMPACT_IN.has(e.link_type)) candidates.push({ next: e.from_note, type: e.link_type });
      for (const e of g.out.get(cur) ?? []) if (e.to_note && IMPACT_OUT.has(e.link_type)) candidates.push({ next: e.to_note, type: e.link_type });
      for (const c of candidates) {
        if (seen.has(c.next) || !visible(g, c.next, opts)) continue;
        if (seen.size >= MAX_NODES) {
          truncated = true;
          continue;
        }
        seen.set(c.next, { depth: d, via: cur, linkType: c.type });
        nf.push(c.next);
      }
    }
    frontier = nf;
  }
  const ids = new Set(seen.keys());
  const keys = new Map<string, Set<string>>();
  for (const n of ids) {
    for (const e of g.out.get(n) ?? []) {
      if (e.kind === "github" && e.link_type === "tracked_by") {
        const key = e.to_ref.replace(/^gh:/, "");
        (keys.get(key) ?? keys.set(key, new Set()).get(key))?.add(n);
      }
    }
  }
  const ghNodes = new Map((await store.ghNodes([...keys.keys()])).map((n) => [n.key, n]));
  return {
    root: id,
    notes: [...seen].filter(([n]) => n !== id).map(([n, m]) => ({ ...node(g, n, m.depth), via: m.via, linkType: m.linkType })),
    edges: induced(g, ids),
    github: [...keys].map(([key, notes]) => ({ key, node: ghNodes.get(key) ?? null, notes: [...notes] })),
    truncated,
  };
}

export interface LintResult {
  orphans: string[];
  broken: { from: string; target: string; line: number }[];
}

export async function lint(store: IndexStore, opts: GraphOptions = {}): Promise<LintResult> {
  const g = await store.graph();
  const orphans: string[] = [];
  for (const id of g.nodes.keys()) {
    if (!visible(g, id, opts)) continue;
    const linksOut = (g.out.get(id) ?? []).some((e) => e.to_note || e.kind === "github");
    if (!linksOut && !(g.in.get(id)?.length)) orphans.push(id);
  }
  const broken = g.edges
    .filter((e) => e.kind === "note" && !e.to_note && visible(g, e.from_note, opts))
    .map((e) => ({ from: e.from_note, target: e.to_ref, line: e.line }));
  return { orphans: orphans.sort(), broken };
}
