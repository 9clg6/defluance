import { stringify } from "yaml";

const FM = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Scalar as YAML text: `approved`, `"needs: quoting"`. */
const scalar = (v: string) => stringify(v).trim();

function split(raw: string): { lines: string[]; rest: string; eol: string } {
  const m = FM.exec(raw);
  if (!m) throw new Error("note has no frontmatter");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  return { lines: (m[1] ?? "").split(/\r?\n/), rest: raw.slice(m[0].length), eol };
}

const join = (lines: string[], rest: string, eol: string) => `---${eol}${lines.join(eol)}${eol}---${eol}${rest}`;

/**
 * Set a top-level scalar field in place. Other lines (comments, ordering, quoting) are left untouched,
 * unlike a parse and re-serialise round trip.
 */
export function setFrontmatterField(raw: string, key: string, value: string): string {
  const { lines, rest, eol } = split(raw);
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`);
  const at = lines.findIndex((l) => re.test(l));
  const line = `${key}: ${scalar(value)}`;
  if (at === -1) lines.push(line);
  else lines[at] = line;
  return join(lines, rest, eol);
}

/** Add `"[[target|type]]"` to the frontmatter `links:` list, creating the list when needed. No-op if already present. */
export function addFrontmatterLink(raw: string, target: string, type: string): string {
  const { lines, rest, eol } = split(raw);
  const item = `  - ${JSON.stringify(`[[${target}|${type}]]`)}`;
  const at = lines.findIndex((l) => /^links:/.test(l));
  if (at === -1) {
    lines.push("links:", item);
    return join(lines, rest, eol);
  }
  const inline = (lines[at] ?? "").slice("links:".length).trim();
  if (inline && inline !== "[]") throw new Error("links: uses an unsupported inline format, edit the note by hand");
  let end = at + 1;
  while (end < lines.length && /^\s+-|^\s*$/.test(lines[end] ?? "")) end++;
  while (end > at + 1 && /^\s*$/.test(lines[end - 1] ?? "")) end--;
  if (lines.slice(at + 1, end).some((l) => l.trim() === item.trim())) return raw;
  lines[at] = "links:";
  lines.splice(end, 0, item);
  return join(lines, rest, eol);
}
