const SLUG = /^[\w.-]+\/[\w.-]+$/;
const URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/pulls?)?\/?(?:[?#].*)?$/i;

/** `owner/name` from what a person typed or pasted: the slug itself, or a github.com address (also its /pulls page). Null when it is neither. */
export function normaliseRepo(input: string): string | null {
  const s = input.trim();
  if (SLUG.test(s)) return s;
  const m = URL_RE.exec(s);
  return m ? `${m[1]}/${m[2]}` : null;
}
