import { createHash } from "node:crypto";

export interface Chunk {
  heading: string;
  ordinal: number;
  content: string;
  hash: string;
}

/** ~800 tokens at ~4 chars/token. */
const MAX_CHARS = 3200;
const OVERLAP = 320;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** `[[a#h|b]]` -> `b`, `[[a]]` -> `a`: keep the words, drop the syntax. */
function plainLinks(text: string): string {
  return text.replace(/!?\[\[([^[\]\n]+?)\]\]/g, (_, inner: string) => {
    const [left = "", alias] = inner.split("|");
    return (alias ?? left.split("#")[0] ?? left).trim();
  });
}

function splitLong(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];
  const out: string[] = [];
  const paras = text.split(/\n{2,}/);
  let cur = "";
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = cur.slice(Math.max(0, cur.length - OVERLAP));
  };
  for (const p of paras) {
    if (cur.length + p.length + 2 > MAX_CHARS && cur.length > OVERLAP) flush();
    cur += (cur ? "\n\n" : "") + p;
    while (cur.length > MAX_CHARS) {
      // single paragraph too long: cut on whitespace
      const cut = cur.lastIndexOf(" ", MAX_CHARS);
      out.push(cur.slice(0, cut > 0 ? cut : MAX_CHARS).trim());
      cur = cur.slice(Math.max(0, (cut > 0 ? cut : MAX_CHARS) - OVERLAP));
    }
  }
  if (cur.trim() && !out.some((o) => o.endsWith(cur.trim()))) out.push(cur.trim());
  return out;
}

/** Split a note body by headings, then by size. Fenced code is never mistaken for a heading. */
export function chunkBody(body: string, title: string): Chunk[] {
  const sections: { heading: string; lines: string[] }[] = [{ heading: title, lines: [] }];
  const stack: string[] = [];
  let fence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence ? /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line) : null;
    if (m) {
      const depth = (m[1] as string).length;
      stack.length = depth - 1;
      stack[depth - 1] = m[2] as string;
      sections.push({ heading: stack.filter(Boolean).join(" > "), lines: [] });
    } else {
      sections[sections.length - 1]?.lines.push(line);
    }
  }
  const chunks: Chunk[] = [];
  for (const [i, s] of sections.entries()) {
    let text = plainLinks(s.lines.join("\n")).trim();
    if (!text) {
      // An empty section still says something ("Open questions", a TODO outline). A heading that only introduces
      // sub-headings is already carried by their paths; a leaf heading would otherwise vanish from search.
      const parent = sections[i + 1]?.heading.startsWith(`${s.heading} > `);
      if (i === 0 || parent) continue;
      text = s.heading;
    }
    for (const part of splitLong(text)) {
      chunks.push({ heading: s.heading, ordinal: chunks.length, content: part, hash: sha256(`${s.heading}\n${part}`) });
    }
  }
  return chunks;
}
