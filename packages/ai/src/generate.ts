import { parseDocument } from "yaml";
import type { Llm } from "./providers.js";

export type GenerateMode = "fill" | "improve";

/** A note given to the model as context. */
export interface ContextNote {
  id: string;
  title: string;
  excerpt: string;
}

export interface GenerateRequest {
  mode: GenerateMode;
  instruction?: string | undefined;
  note: { id: string; title: string; text: string };
  /** Frontmatter values the model may never change. A missing one stays missing. */
  original: { type?: string | null | undefined; status?: string | null | undefined; owner?: string | null | undefined };
  /** Template of the note's type, with its `<!-- ai: ... -->` hints. */
  template: string | null;
  schema: { types: string[]; statuses: string[]; linkTypes: string[] };
  /** Notes linked to this one. */
  linked: ContextNote[];
  /** Notes found by search. */
  related: ContextNote[];
}

/** What the sanitizer needs from `parseNote`: injected, so this package does not depend on the vault format. */
export interface ParsedLike {
  frontmatter: Record<string, unknown>;
  frontmatterError?: string | undefined;
  links: { target: string; kind: "note" | "github"; type: string }[];
}

export interface GenerateEnv {
  parse(text: string): ParsedLike;
  /** The note id (or `gh:` key) a link points at, or null when there is no such note. */
  resolve(link: { target: string; kind: "note" | "github" }): string | null | Promise<string | null>;
}

export interface GenerateResult {
  content: string;
  /** Typed links of the final text that resolve. */
  links: { to: string; type: string }[];
  warnings: string[];
}

/** The model's text is unusable even after one retry. */
export class GenerateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerateError";
  }
}

export const DEFAULT_IMPROVE = "Improve clarity and completeness, and make the acceptance criteria concrete and testable.";
export const DEFAULT_FILL = "Complete every section.";

export const GENERATE_SYSTEM = [
  "You write and improve specification notes for a team's Markdown vault.",
  "Reply with the complete note only: YAML frontmatter between --- lines, then the Markdown body. No code fence, no commentary.",
  "Keep the frontmatter fields type, status and owner exactly as given. Never change status.",
  "Use ONLY the notes provided as context; do not invent facts, numbers or other notes.",
  "Link to a provided note with [[note-id|link-type]], using the ids and link types listed. Never link to a note that is not listed.",
  "Text inside <!-- ai: ... --> comments of the template is guidance for you: follow it and do not copy it.",
  "Write in the language of the note and the instruction.",
].join(" ");

const attr = (s: string) => s.replace(/["\n]/g, " ");
const block = (tag: string, attrs: string, text: string) => `<${tag}${attrs}>\n${text.trim()}\n</${tag}>`;

export function buildGeneratePrompt(r: GenerateRequest): string {
  const instruction = r.instruction?.trim() || (r.mode === "fill" ? DEFAULT_FILL : DEFAULT_IMPROVE);
  const parts = [
    `Task: ${r.mode === "fill" ? "fill: complete the sections of the note, following the template" : "improve: rewrite the existing text"}`,
    block("instruction", "", instruction),
    `Note id: ${r.note.id}`,
    `Title: ${r.note.title}`,
    `Types: ${r.schema.types.join(", ")}`,
    `Statuses: ${r.schema.statuses.join(", ")}`,
    `Link types: ${r.schema.linkTypes.join(", ")}`,
  ];
  if (r.template) parts.push(block("template", "", r.template));
  parts.push(block("note", "", r.note.text));
  for (const n of r.linked) parts.push(block("linked", ` id="${attr(n.id)}" title="${attr(n.title)}"`, n.excerpt));
  for (const n of r.related) parts.push(block("related", ` id="${attr(n.id)}" title="${attr(n.title)}"`, n.excerpt));
  return parts.join("\n");
}

const FM = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;
const WIKILINK = /!?\[\[([^[\]\n]+?)\]\]/g;
const FENCE = /^```[\w-]*[ \t]*\n([\s\S]*?)\n?```$/;

class Rejected extends Error {}

/** `[[target#heading|alias]]` or `gh:o/r#1`, as the target a link resolves by. */
function targetOf(inner: string): { target: string; kind: "note" | "github"; alias?: string } | null {
  const bar = inner.indexOf("|");
  const left = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  const alias = bar === -1 ? undefined : inner.slice(bar + 1).trim();
  const github = left.startsWith("gh:");
  const target = github ? left : (left.split("#")[0] ?? "").trim();
  if (!target) return null;
  return { target, kind: github ? "github" : "note", ...(alias ? { alias } : {}) };
}

/**
 * Turn the model's text into a note that is safe to hand back. Every rule is enforced here, not asked of the model:
 * the text must parse; type, status and owner are the original's; links to notes that do not exist are dropped.
 */
async function sanitize(raw: string, r: GenerateRequest, env: GenerateEnv): Promise<GenerateResult> {
  const warnings: string[] = [];
  let text = raw.replace(/\r\n/g, "\n").trim();
  const fenced = FENCE.exec(text);
  if (fenced) text = (fenced[1] ?? "").trim();
  const m = FM.exec(text);
  if (!m) throw new Rejected("the note has no YAML frontmatter between --- lines");
  const first = env.parse(text);
  if (first.frontmatterError) throw new Rejected(`the frontmatter is not valid YAML: ${first.frontmatterError}`);
  if (!Object.keys(first.frontmatter).length) throw new Rejected("the frontmatter is empty");

  const memo = new Map<string, string | null>();
  const resolve = async (l: { target: string; kind: "note" | "github" }) => {
    const key = `${l.kind}|${l.target}`;
    if (!memo.has(key)) memo.set(key, await env.resolve(l));
    return memo.get(key) ?? null;
  };
  const dropped = new Set<string>();
  const drop = (target: string) => {
    if (!dropped.has(target)) {
      dropped.add(target);
      warnings.push(`removed a link to "${target}": no such note`);
    }
  };

  // frontmatter: forced fields, then the `links:` entries
  const doc = parseDocument(m[1] ?? "");
  if (doc.errors.length) throw new Rejected(`the frontmatter is not valid YAML: ${doc.errors[0]?.message.split("\n")[0] ?? ""}`);
  const fm = (doc.toJS() ?? {}) as Record<string, unknown>;
  let edited = false;
  for (const key of ["type", "status", "owner"] as const) {
    const want = r.original[key];
    if (typeof want === "string" && want) {
      if (fm[key] !== want) {
        if (key === "status" && fm[key] !== undefined) warnings.push(`status was changed to "${String(fm[key])}": restored to "${want}" (only a person changes a note's status)`);
        else if (fm[key] !== undefined) warnings.push(`"${key}" was changed: restored to "${want}"`);
        doc.set(key, want);
        edited = true;
      }
    } else if (fm[key] !== undefined) {
      doc.delete(key);
      edited = true;
    }
  }
  if (Array.isArray(fm["links"])) {
    const keep: unknown[] = [];
    for (const item of fm["links"] as unknown[]) {
      const inner = typeof item === "string" ? item.trim().replace(/^\[\[|\]\]$/g, "") : item && typeof item === "object" && typeof (item as { to?: unknown }).to === "string" ? (item as { to: string }).to : null;
      const t = inner === null ? null : targetOf(inner);
      if (t && !(await resolve(t))) drop(t.target);
      else keep.push(item);
    }
    if (keep.length !== (fm["links"] as unknown[]).length) {
      if (keep.length) doc.set("links", doc.createNode(keep));
      else doc.delete("links");
      edited = true;
    }
  }
  const head = edited ? `---\n${doc.toString({ lineWidth: 0 }).trimEnd()}\n---\n` : (m[0].endsWith("\n") ? m[0] : `${m[0]}\n`);

  // body: a wikilink to a note that does not exist becomes plain text
  let body = text.slice(m[0].length);
  const known = new Set(env.parse(`${head}${body}`).links.map((l) => l.target));
  const decisions = new Map<string, string>();
  for (const w of body.matchAll(WIKILINK)) {
    const t = targetOf(w[1] ?? "");
    if (!t || !known.has(t.target) || decisions.has(w[0])) continue;
    if (!(await resolve(t))) {
      drop(t.target);
      decisions.set(w[0], t.target);
    }
  }
  if (decisions.size) body = body.replace(WIKILINK, (all) => decisions.get(all) ?? all);

  const content = `${head}${body}`.trimEnd() + "\n";
  const final = env.parse(content);
  if (final.frontmatterError) throw new Rejected(`the frontmatter is not valid YAML: ${final.frontmatterError}`);
  const links: GenerateResult["links"] = [];
  for (const l of final.links) {
    const to = await resolve(l);
    if (to && !links.some((x) => x.to === to && x.type === l.type)) links.push({ to, type: l.type });
  }
  return { content, links, warnings };
}

/**
 * Ask the model to fill or improve a note and return text that is safe to show in an editor. Never writes anything.
 * Output that does not parse is retried once, then rejected with a `GenerateError`.
 */
export async function generateNote(llm: Llm, r: GenerateRequest, env: GenerateEnv): Promise<GenerateResult> {
  const prompt = buildGeneratePrompt(r);
  let reason = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const ask = attempt === 0 ? prompt : `${prompt}\n\nYour previous answer was rejected: ${reason}. Reply again with the complete note, starting with the YAML frontmatter between --- lines.`;
    try {
      return await sanitize(await llm.generate(GENERATE_SYSTEM, ask), r, env);
    } catch (e) {
      if (!(e instanceof Rejected)) throw e;
      reason = e.message;
    }
  }
  throw new GenerateError(`the model did not return a valid note (${reason}); try again or give a more precise instruction`);
}
