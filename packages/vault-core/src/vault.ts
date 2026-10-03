import { readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { parseNote, type Link, type ParsedNote } from "./parse.js";

export type Resolution =
  | { status: "resolved"; note: ParsedNote; ambiguous: number; headingFound: boolean }
  | { status: "missing" };

export interface Vault {
  root: string;
  notes: ParsedNote[];
  resolve(link: Link, fromId: string): Resolution;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function shortestFirst(a: ParsedNote, b: ParsedNote): number {
  return a.id.length - b.id.length || a.id.localeCompare(b.id);
}

function aliasesOf(note: ParsedNote): string[] {
  const a = note.frontmatter["aliases"] ?? note.frontmatter["alias"];
  if (typeof a === "string") return [a];
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
}

/** Obsidian-compatible link resolution: full path, then shortest basename match, then frontmatter alias. */
export function buildVault(root: string, notes: ParsedNote[]): Vault {
  const byId = new Map<string, ParsedNote>();
  const byName = new Map<string, ParsedNote[]>();
  const byAlias = new Map<string, ParsedNote>();
  for (const n of [...notes].sort(shortestFirst)) {
    byId.set(norm(n.id), n);
    const name = norm(posix.basename(n.id));
    byName.set(name, [...(byName.get(name) ?? []), n]);
    for (const a of aliasesOf(n)) if (!byAlias.has(norm(a))) byAlias.set(norm(a), n);
  }

  function find(rawTarget: string, fromId: string): { note: ParsedNote; ambiguous: number } | null {
    const target = norm(rawTarget.replace(/^\/+/, "").replace(/\.md$/i, ""));
    if (target.includes("/")) {
      const fromDir = posix.dirname(fromId);
      const rel = norm(posix.normalize(posix.join(fromDir === "." ? "" : fromDir, target)));
      const hit = byId.get(target) ?? byId.get(rel);
      if (hit) return { note: hit, ambiguous: 1 };
      const suffix = notes.filter((n) => norm(n.id).endsWith("/" + target)).sort(shortestFirst);
      const first = suffix[0];
      return first ? { note: first, ambiguous: suffix.length } : null;
    }
    const named = byName.get(target);
    const first = named?.[0];
    if (first && named) return { note: first, ambiguous: named.length };
    const aliased = byAlias.get(target);
    return aliased ? { note: aliased, ambiguous: 1 } : null;
  }

  return {
    root,
    notes,
    resolve(link, fromId) {
      if (link.kind === "github") return { status: "missing" };
      const hit = find(link.target, fromId);
      if (!hit) return { status: "missing" };
      const headingFound =
        !link.heading ||
        link.heading.startsWith("^") ||
        hit.note.headings.some((h) => norm(h.text) === norm(link.heading ?? ""));
      return { status: "resolved", note: hit.note, ambiguous: hit.ambiguous, headingFound };
    },
  };
}

/** Directories never scanned: dot-folders (.git, .obsidian, .defluance) and node_modules. */
export function skipped(rel: string): boolean {
  return rel.split(/[\\/]/).some((seg) => seg.startsWith(".") || seg === "node_modules");
}

/** Relative POSIX paths of all notes under root. */
export async function listMarkdown(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries
    .filter((e) => e.toLowerCase().endsWith(".md") && !skipped(e))
    .map((e) => e.split("\\").join("/"))
    .sort();
}

export async function loadVault(root: string, linkTypes?: readonly string[]): Promise<Vault> {
  const entries = await readdir(root, { recursive: true });
  const files = entries.filter((e) => e.toLowerCase().endsWith(".md") && !skipped(e)).sort();
  const notes = await Promise.all(
    files.map(async (rel) => {
      const path = rel.split("\\").join("/");
      const raw = await readFile(join(root, rel), "utf8");
      return parseNote(path, raw, linkTypes ? { linkTypes } : {});
    }),
  );
  return buildVault(root, notes);
}
