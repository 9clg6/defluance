import { impact as graphImpact } from "@defluance/indexer";
import { type Actor } from "../auth.js";
import { type Ctx } from "../context.js";
import { notFound } from "../errors.js";
import { readSpaces } from "./shared.js";

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
