// Words of a query worth highlighting: same idea as the server's query tokens (no stop words).
const STOP = new Set(
  (
    "a an and are as at be but by can could do does did for from has have how i if in into is it its of on or our so than that the their them then there these they this to was we were what when where which who why will with would you your " +
    "au aux avec ce ces dans de des du elle en est et il ils je la le les leur lui ma mais me mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous comment quel quelle"
  ).split(" "),
);

/** Lower-case, accents removed, one character in for one character out so positions line up. */
export function fold(text: string): string {
  let out = "";
  for (const ch of text) {
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += (base[0] ?? ch).toLowerCase().padEnd(ch.length, " ").slice(0, ch.length);
  }
  return out;
}

export function queryTerms(query: string): string[] {
  const all = fold(query).match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const kept = all.filter((t) => !STOP.has(t));
  return [...new Set(kept.length ? kept : all)];
}

export interface Segment {
  text: string;
  hit: boolean;
}

/** Split text into plain and highlighted parts. A term also marks the words it starts (`reset` marks `resets`). */
export function highlight(text: string, terms: string[]): Segment[] {
  if (!terms.length) return [{ text, hit: false }];
  const folded = fold(text);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[\\p{L}\\p{N}]*`, "gu");
  const out: Segment[] = [];
  let last = 0;
  for (const m of folded.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: text.slice(m.index, m.index + m[0].length), hit: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length ? out : [{ text, hit: false }];
}
