const FM = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Split a note into its frontmatter text and body, for the live preview. */
export function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const m = FM.exec(raw);
  return m ? { frontmatter: m[1] ?? "", body: raw.slice(m[0].length) } : { frontmatter: "", body: raw };
}

/** `a/b/My note` -> `my-note` */
export function slugFromTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function relativeTime(iso: string, lang: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86_400_000], ["hour", 3_600_000], ["minute", 60_000]];
  for (const [u, ms] of units) if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), u);
  return rtf.format(0, "second");
}

/** A note's own `# Title` heading repeats the page title: drop it when it matches. */
export function stripTitle(body: string, title: string): string {
  const m = /^\s*#\s+(.+?)\s*(?:\r?\n|$)/.exec(body);
  if (!m || (m[1] ?? "").trim().toLowerCase() !== title.trim().toLowerCase()) return body;
  return body.slice(m[0].length).replace(/^\s*\n/, "");
}
