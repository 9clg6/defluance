import { posix } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parse as parseYaml } from "yaml";
import { LINK_TYPES } from "@defluance/shared";

export interface Heading {
  depth: number;
  text: string;
  line: number;
}

export interface Link {
  /** Note id, alias or `gh:owner/repo#n`. */
  target: string;
  kind: "note" | "github";
  heading?: string;
  /** Raw text after `|`. */
  alias?: string;
  /** Link type. `related` when the alias is not a known type. */
  type: string;
  /** Alias given but not a known link type (Obsidian display alias or typo). */
  unknownType?: string;
  /** Declared as structured frontmatter: an unknown type is then an error. */
  strict: boolean;
  source: "body" | "frontmatter";
  line: number;
}

export interface ParsedNote {
  /** Path relative to the vault root, POSIX, without `.md`. Unique. */
  id: string;
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  frontmatterError?: string;
  headings: Heading[];
  links: Link[];
  /** `#tags` written in the text, like Obsidian: not in code, and not a number such as `#123`. Without the `#`. */
  inlineTags: string[];
}

export interface ParseOptions {
  linkTypes?: readonly string[];
}

const ATTACHMENT = /\.(png|jpe?g|gif|svg|webp|avif|pdf|mp3|mp4|wav|webm|mov|ogg|csv)$/i;
const WIKILINK = /\[\[([^[\]\n]+?)\]\]/g;
/** A tag needs a letter first, and must start a word: `#idea`, `#team/backend`, not `#123`, `a#b` or `https://x/y#z`. */
const INLINE_TAG = /(?<![\w/#&])#([\p{L}][\p{L}\p{N}_/-]*)/gu;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const processor = unified().use(remarkParse).use(remarkGfm);

interface MdNode {
  type: string;
  value?: string;
  depth?: number;
  children?: MdNode[];
  position?: { start: { line: number } };
}

function plainText(node: MdNode): string {
  if (node.value !== undefined) return node.value;
  return (node.children ?? []).map(plainText).join("");
}

/** Parse the inside of `[[...]]`, also used for frontmatter string links. */
export function parseLinkInner(
  inner: string,
  line: number,
  source: Link["source"],
  linkTypes: readonly string[],
): Link | null {
  const bar = inner.indexOf("|");
  const left = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  const alias = bar === -1 ? undefined : inner.slice(bar + 1).trim();
  if (!left || ATTACHMENT.test(left)) return null;

  let target = left;
  let heading: string | undefined;
  const github = left.startsWith("gh:");
  if (!github) {
    const hash = left.indexOf("#");
    if (hash !== -1) {
      target = left.slice(0, hash).trim();
      heading = left.slice(hash + 1).trim();
    }
  }
  if (!target) return null; // `[[#heading]]` links inside the same note: ignored

  const known = alias !== undefined && linkTypes.includes(alias);
  const link: Link = {
    target,
    kind: github ? "github" : "note",
    type: known ? alias : "related",
    strict: false,
    source,
    line,
  };
  if (heading) link.heading = heading;
  if (alias) link.alias = alias;
  if (alias && !known) link.unknownType = alias;
  return link;
}

function frontmatterLinks(fm: Record<string, unknown>, linkTypes: readonly string[]): Link[] {
  const raw = fm["links"];
  if (!Array.isArray(raw)) return [];
  const out: Link[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const inner = entry.trim().replace(/^\[\[|\]\]$/g, "");
      const link = parseLinkInner(inner, 1, "frontmatter", linkTypes);
      if (link) out.push(link);
    } else if (entry && typeof entry === "object") {
      const { to, type } = entry as { to?: unknown; type?: unknown };
      if (typeof to !== "string") continue;
      const link = parseLinkInner(typeof type === "string" ? `${to}|${type}` : to, 1, "frontmatter", linkTypes);
      if (link) out.push({ ...link, strict: true });
    }
  }
  return out;
}

/** Body of a note without its frontmatter. */
export function bodyOf(raw: string): string {
  const m = FRONTMATTER.exec(raw);
  return m ? raw.slice(m[0].length) : raw;
}

export function parseNote(path: string, raw: string, options: ParseOptions = {}): ParsedNote {
  const linkTypes = options.linkTypes ?? LINK_TYPES;
  const id = path.replace(/\.md$/i, "");
  let frontmatter: Record<string, unknown> = {};
  let frontmatterError: string | undefined;
  let body = raw;
  let offset = 0;

  const match = FRONTMATTER.exec(raw);
  if (match) {
    body = raw.slice(match[0].length);
    offset = match[0].split("\n").length - 1;
    try {
      const data: unknown = parseYaml(match[1] ?? "");
      if (data && typeof data === "object" && !Array.isArray(data)) {
        frontmatter = data as Record<string, unknown>;
      } else if (data !== null && data !== undefined) {
        frontmatterError = "frontmatter must be a YAML mapping";
      }
    } catch (e) {
      frontmatterError = e instanceof Error ? e.message.split("\n")[0] ?? "invalid YAML" : "invalid YAML";
    }
  }

  const headings: Heading[] = [];
  const links: Link[] = frontmatterLinks(frontmatter, linkTypes);
  const inlineTags = new Set<string>();

  // Walking the mdast tree skips code blocks and inline code for free.
  const walk = (node: MdNode): void => {
    if (node.type === "code" || node.type === "inlineCode") return;
    const line = (node.position?.start.line ?? 1) + offset;
    if (node.type === "heading") {
      headings.push({ depth: node.depth ?? 1, text: plainText(node).trim(), line });
    } else if (node.type === "text" && node.value) {
      for (const m of node.value.matchAll(INLINE_TAG)) inlineTags.add((m[1] as string).replace(/[/-]+$/, ""));
      for (const m of node.value.matchAll(WIKILINK)) {
        const upTo = node.value.slice(0, m.index);
        const extra = upTo.split("\n").length - 1;
        const link = parseLinkInner(m[1] ?? "", line + extra, "body", linkTypes);
        if (link) links.push(link);
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(processor.parse(body) as unknown as MdNode);

  const fmTitle = frontmatter["title"];
  const h1 = headings.find((h) => h.depth === 1)?.text;
  const title = (typeof fmTitle === "string" && fmTitle) || h1 || posix.basename(id);

  const note: ParsedNote = { id, path, title, frontmatter, headings, links, inlineTags: [...inlineTags].sort() };
  if (frontmatterError) note.frontmatterError = frontmatterError;
  return note;
}
