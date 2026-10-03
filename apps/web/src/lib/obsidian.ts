/*
 * Obsidian's Markdown extras, as remark plugins on top of GitHub-flavoured Markdown:
 *   ![[picture.png|300]]   an embedded picture, with a width            ![[spec.pdf]]  a link to a file
 *   ![[Other note#Part]]   another note (or one of its sections) shown in place
 *   > [!warning] Title     a callout; `+` or `-` after the type makes it foldable
 *   ==highlighted==        a highlight        %%a comment%%   which is not shown        #tags   in the text
 * They work on the syntax tree, so code and inline code are never touched.
 */

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const VIDEO = /\.(mp4|webm|mov)$/i;
const AUDIO = /\.(mp3|wav|ogg)$/i;
const FILE = /\.(pdf|csv)$/i;

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  title?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

export interface ObsidianOptions {
  /** Where a file embedded by a note is served from. */
  attachmentUrl: (ref: string) => string;
}

export const isAttachment = (ref: string) => IMAGE.test(ref) || VIDEO.test(ref) || AUDIO.test(ref) || FILE.test(ref);

/** `![[target#heading|alias]]` as a node: a media element, a file link, or a note embed (a link the renderer expands). */
export function embedNode(inner: string, o: ObsidianOptions): MdNode {
  const bar = inner.indexOf("|");
  const left = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  const alias = bar === -1 ? "" : inner.slice(bar + 1).trim();
  const name = left.split("/").at(-1) ?? left;
  if (IMAGE.test(left)) {
    const width = /^\d+(x\d+)?$/.test(alias) ? alias.split("x")[0] : undefined;
    return { type: "image", url: o.attachmentUrl(left), alt: width || !alias ? name : alias, ...(width ? { data: { hProperties: { width } } } : {}) };
  }
  if (VIDEO.test(left) || AUDIO.test(left)) {
    return { type: "emphasis", children: [], data: { hName: VIDEO.test(left) ? "video" : "audio", hProperties: { src: o.attachmentUrl(left), controls: true, "aria-label": alias || name } } };
  }
  if (FILE.test(left)) return { type: "link", url: o.attachmentUrl(left), title: name, children: [{ type: "text", value: alias || name }] };
  return { type: "link", url: `#embed:${encodeURIComponent(left)}`, children: [{ type: "text", value: alias || left }] };
}

/** Text nodes, with `%%comments%%` removed, `==marks==`, `![[embeds]]` and `#tags` turned into nodes. */
export function transformText(value: string, o: ObsidianOptions): MdNode[] {
  const text = value.replace(/%%[\s\S]*?%%/g, "");
  if (!text) return [];
  const out: MdNode[] = [];
  const re = /!\[\[([^[\]\n]+?)\]\]|==(?=\S)([^=\n]+?)(?<=\S)==|(?<![\w/#&])#([\p{L}][\p{L}\p{N}_/-]*)/gu;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push(embedNode(m[1], o));
    else if (m[2] !== undefined) out.push({ type: "emphasis", children: [{ type: "text", value: m[2] }], data: { hName: "mark" } });
    else out.push({ type: "emphasis", children: [{ type: "text", value: `#${m[3] as string}` }], data: { hName: "span", hProperties: { className: ["note-tag"] } } });
    last = m.index + m[0].length;
  }
  if (!out.length) return [{ type: "text", value: text }];
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

const CALLOUT = /^\[!([A-Za-z]+)\]([+-])?[ \t]*(.*)$/;

/** A blockquote that starts with `[!type] Title` is a callout. Returns the replacement, or null for an ordinary quote. */
export function calloutNode(quote: MdNode): MdNode | null {
  const first = quote.children?.[0];
  const head = first?.type === "paragraph" ? first.children?.[0] : undefined;
  if (!first || head?.type !== "text" || !head.value) return null;
  const nl = head.value.indexOf("\n");
  const line = nl === -1 ? head.value : head.value.slice(0, nl);
  const m = CALLOUT.exec(line);
  if (!m) return null;
  const kind = (m[1] as string).toLowerCase();
  const fold = m[2];
  const title = (m[3] ?? "").trim() || kind.charAt(0).toUpperCase() + kind.slice(1);
  const rest = nl === -1 ? "" : head.value.slice(nl + 1);
  const body: MdNode[] = [];
  const remaining: MdNode[] = [...(rest ? [{ ...head, value: rest }] : []), ...(first.children ?? []).slice(1)];
  if (remaining.length) body.push({ ...first, children: remaining });
  body.push(...(quote.children ?? []).slice(1));
  const foldable = fold !== undefined;
  const titleNode: MdNode = { type: "paragraph", children: [{ type: "text", value: title }], data: { hName: foldable ? "summary" : "p", hProperties: { className: ["callout-title"] } } };
  return { type: "blockquote", children: [titleNode, ...body], data: { hName: foldable ? "details" : "div", hProperties: { className: ["callout", `callout-${kind}`], ...(fold === "+" ? { open: true } : {}) } } };
}

export function remarkObsidian(o: ObsidianOptions) {
  return () => (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type === "text" && child.value) return transformText(child.value, o);
        if (child.type === "blockquote") {
          const callout = calloutNode(child);
          if (callout) {
            walk(callout);
            return [callout];
          }
        }
        walk(child);
        return [child];
      });
    };
    walk(tree);
  };
}

/** Where `src` points, for a note stored at `noteId`: a path relative to the note's folder, or from the vault root. */
export function resolveAttachment(noteId: string, src: string): { primary: string; fallback: string } {
  const base = "/api/v1/files/";
  const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
  const parts = noteId.split("/").slice(0, -1);
  for (const seg of src.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  const fromRoot = src.replace(/^\.?\/+/, "");
  return { primary: base + enc(parts.join("/")), fallback: base + enc(fromRoot) };
}

/** The part of a note below a heading, up to the next heading of the same level or higher. The whole text without a heading. */
export function sectionOf(body: string, heading?: string): string {
  if (!heading) return body;
  const lines = body.split("\n");
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  let fence = false;
  let from = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence ? /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line) : null;
    if (!m) continue;
    if (from === -1) {
      if (norm(m[2] as string) === norm(heading)) {
        from = i;
        level = (m[1] as string).length;
      }
    } else if ((m[1] as string).length <= level) {
      return lines.slice(from + 1, i).join("\n").trim();
    }
  }
  return from === -1 ? body : lines.slice(from + 1).join("\n").trim();
}
