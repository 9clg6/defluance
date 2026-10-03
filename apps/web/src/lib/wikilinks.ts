import type { LinkView } from "./types";
import { notePath, slugify } from "./api";

export interface WikiRef {
  target: string;
  heading?: string;
  alias?: string;
  github: boolean;
}

const ATTACHMENT = /\.(png|jpe?g|gif|svg|webp|avif|pdf|mp3|mp4|wav|webm|mov|ogg|csv)$/i;
const WIKILINK = /!?\[\[([^[\]\n]+?)\]\]/g;

/** Same grammar as the vault: `[[target#heading|alias]]`, `gh:` keys keep their `#`. */
export function parseWikiRef(inner: string): WikiRef | null {
  const bar = inner.indexOf("|");
  const left = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  const alias = bar === -1 ? undefined : inner.slice(bar + 1).trim();
  if (!left || ATTACHMENT.test(left)) return null;
  const github = left.startsWith("gh:");
  let target = left;
  let heading: string | undefined;
  if (!github) {
    const hash = left.indexOf("#");
    if (hash !== -1) {
      target = left.slice(0, hash).trim();
      heading = left.slice(hash + 1).trim();
    }
  }
  if (!target) return null;
  return { target, ...(heading ? { heading } : {}), ...(alias ? { alias } : {}), github };
}

export interface Resolved {
  href: string;
  label: string;
}

export const GH_STATE_MARK = "#dfl-";

/**
 * Resolve a reference to a URL using the links the server already resolved for this note.
 * Broken links get `#broken`, GitHub objects carry their state after `#dfl-`.
 */
export function makeResolver(links: LinkView[]): (ref: WikiRef) => Resolved {
  const byTarget = new Map(links.map((l) => [l.target.toLowerCase(), l]));
  return (ref) => {
    const hit = byTarget.get((ref.github ? ref.target : ref.target).toLowerCase());
    if (ref.github) {
      const key = ref.target.replace(/^gh:/, "");
      const gh = hit?.github;
      return { href: gh?.url ? `${gh.url}${GH_STATE_MARK}${gh.state}` : `#broken`, label: `${key}${gh ? ` · ${gh.state}` : ""}` };
    }
    if (hit?.note) return { href: notePath(hit.note.id, ref.heading), label: ref.alias && !isTypeAlias(ref.alias) ? ref.alias : (hit.note.title || ref.target) };
    return { href: "#broken", label: ref.alias && !isTypeAlias(ref.alias) ? ref.alias : ref.target };
  };
}

const LINK_TYPES = new Set(["implements", "depends_on", "supersedes", "tested_by", "tracked_by", "blocks", "related"]);
const isTypeAlias = (a: string) => LINK_TYPES.has(a);

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

/** remark plugin: turns `[[...]]` in text into links. Code and inline code are untouched (they are not text nodes). */
export function remarkWikilinks(opts: { resolve: (ref: WikiRef) => Resolved }) {
  return () => (tree: MdNode) => {
    const visit = (node: MdNode) => {
      if (!node.children) return;
      const out: MdNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && child.value && child.value.includes("[[")) {
          let last = 0;
          const text = child.value;
          for (const m of text.matchAll(WIKILINK)) {
            const ref = parseWikiRef(m[1] ?? "");
            if (!ref) continue;
            if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
            const r = opts.resolve(ref);
            out.push({ type: "link", url: r.href, children: [{ type: "text", value: r.label }] });
            last = m.index + m[0].length;
          }
          if (last === 0) out.push(child);
          else if (last < text.length) out.push({ type: "text", value: text.slice(last) });
        } else {
          visit(child);
          out.push(child);
        }
      }
      node.children = out;
    };
    visit(tree);
  };
}

export { slugify };
