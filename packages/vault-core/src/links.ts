/**
 * Point the wikilinks of a text at a new target.
 *
 * `[[old]]`, `[[old#Heading]]`, `[[old|type]]` and `[[old#Heading|alias]]` keep their heading and alias; only the target
 * changes. Only the given lines are touched (the lines the parser found links on), so a link-looking text inside a
 * code block that the parser ignored is left alone.
 */
export function retargetLinks(text: string, from: string, to: string, lines?: ReadonlySet<number>): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(\\[\\[\\s*)${escaped}(\\s*(?:[#|][^\\]\\n]*)?\\]\\])`, "g");
  return text
    .split("\n")
    .map((line, i) => (!lines || lines.has(i + 1) ? line.replace(re, (_m, a: string, b: string) => `${a}${to}${b}`) : line))
    .join("\n");
}

/** The lines of the frontmatter block (1-based), where structured links are written. */
export function frontmatterLines(text: string): Set<number> {
  const lines = text.split("\n");
  const out = new Set<number>();
  if (lines[0]?.trim() !== "---") return out;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") return out;
    out.add(i + 1);
  }
  return new Set();
}
