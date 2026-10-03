import type { GhNode } from "./types";

export type GhKind = GhNode["kind"];

export interface Mention {
  /** Offset of the `@` in the text that was given. */
  from: number;
  kind?: GhKind;
  q: string;
}

const KEYWORDS: Record<string, GhKind> = { pr: "pull-request", issue: "issue" };

/**
 * What was typed after an `@` that starts the line or follows a space: `@`, `@fix`, `@12`, `@pr`, `@pr login`, `@issue #12`.
 * `pr` and `issue` (any case) filter by kind; the rest of the line is the query. Without a keyword the query is one word,
 * so a stray `@` in prose does not keep a popup open, and `a@b.com` is never a mention.
 * `text` is the line up to the cursor. Null when the cursor is not in a mention, or inside an open `[[`.
 */
export function parseMention(text: string): Mention | null {
  if (/\[\[[^\]]*$/.test(text)) return null;
  const m = /(?:^|\s)@(?:(pr|issue)(?:\s+([^@]*))?|([^\s@]*))$/i.exec(text);
  if (!m) return null;
  const from = m.index + m[0].indexOf("@");
  const kw = m[1]?.toLowerCase();
  if (kw) return { from, kind: KEYWORDS[kw] as GhKind, q: (m[2] ?? "").trim() };
  return { from, q: m[3] ?? "" };
}

export interface GhLabels {
  pr: string;
  issue: string;
  state: (s: GhNode["state"]) => string;
}

export const EN_LABELS: GhLabels = { pr: "PR", issue: "issue", state: (s) => s };

export interface GhOption {
  /** `#12 Title` */
  label: string;
  /** `PR · open · acme/app` */
  detail: string;
  /** What is inserted. */
  insert: string;
}

/** `owner/repo#12` split in its two halves. */
export const splitKey = (key: string): { repo: string; n: string } => {
  const i = key.lastIndexOf("#");
  return { repo: key.slice(0, i), n: key.slice(i + 1) };
};

export function ghOption(node: Pick<GhNode, "key" | "kind" | "state" | "title">, labels: GhLabels = EN_LABELS): GhOption {
  const { repo, n } = splitKey(node.key);
  return {
    label: `#${n} ${node.title}`,
    detail: [node.kind === "pull-request" ? labels.pr : labels.issue, labels.state(node.state), repo].join(" · "),
    insert: `[[gh:${node.key}]]`,
  };
}
