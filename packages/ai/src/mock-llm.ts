import type { z } from "zod";
import { DEFAULT_FILL } from "./generate.js";
import type { Llm } from "./providers.js";

/** Id of the demo model. It says what it is: nothing here comes from a real model. */
export const MOCK_LLM_ID = "mock:demo";

const STOP = new Set("a an and are as at be by can do does for from how i in is it of on or the to was what when where which who why with you your their our my we they this that these those there about".split(" "));
const keywords = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? []).filter((w) => w.length > 1 && !STOP.has(w));

// ---------------------------------------------------------------- ask

/** First, or most relevant, sentence of a passage: markdown noise removed. */
function sentenceFor(content: string, words: string[]): string {
  const plain = content
    .trim()
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?(?:```|$)/g, "") // diagrams and code are not sentences
    .replace(/^#+\s.*$/gm, "")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1")
    .replace(/[*_`>]|^\s*[-+]\s+(?:\[[ x]\]\s*)?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = plain.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 8);
  if (!sentences.length) return plain.slice(0, 200);
  const score = (s: string) => keywords(s).filter((w) => words.includes(w)).length;
  const best = sentences.reduce((a, b) => (score(b) > score(a) ? b : a));
  return best.slice(0, 240);
}

function answerFrom(prompt: string): string {
  const m = /^Question: ([\s\S]*?)\n\nSources:\n([\s\S]*)$/.exec(prompt);
  if (!m) return "NO_SOURCE";
  const words = keywords(m[1] ?? "");
  const parts = (m[2] ?? "").split(/^\[(\d+)\] .*$/m); // ["", "1", content, "2", content...]
  const out: string[] = [];
  for (let i = 1; i < parts.length && out.length < 3; i += 2) {
    const s = sentenceFor(parts[i + 1] ?? "", words).replace(/[.!?]+$/, "");
    if (s) out.push(`${s} [${parts[i]}].`);
  }
  return out.length ? out.join(" ") : "NO_SOURCE";
}

// ---------------------------------------------------------------- generate

interface Tagged {
  id: string;
  title: string;
  text: string;
}

function tagged(prompt: string, tag: string): Tagged[] {
  const out: Tagged[] = [];
  for (const m of prompt.matchAll(new RegExp(`<${tag}([^>]*)>\\n([\\s\\S]*?)\\n</${tag}>`, "g"))) {
    out.push({ id: /id="([^"]*)"/.exec(m[1] ?? "")?.[1] ?? "", title: /title="([^"]*)"/.exec(m[1] ?? "")?.[1] ?? "", text: m[2] ?? "" });
  }
  return out;
}

const splitFm = (text: string) => {
  const m = /^---\n[\s\S]*?\n---[ \t]*\n?/.exec(text);
  return m ? { fm: m[0].endsWith("\n") ? m[0] : `${m[0]}\n`, body: text.slice(m[0].length) } : { fm: "", body: text };
};

/** `## Heading` sections of a body, with what comes before the first one. */
function sections(body: string): { pre: string; items: { heading: string; text: string }[] } {
  const parts = body.split(/^## +/m);
  return { pre: parts[0] ?? "", items: parts.slice(1).map((p) => ({ heading: (p.split("\n")[0] ?? "").trim(), text: p.split("\n").slice(1).join("\n").trim() })) };
}

const firstSentence = (s: string) => s.trim().replace(/\s+/g, " ").split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]+$/, "") ?? "";

function prose(heading: string, title: string, goal: string, ground: Tagged[]): string {
  const topic = title.toLowerCase();
  const cite = ground[0] ? ` It stays consistent with [[${ground[0].id}|related]] (${ground[0].title}).` : "";
  const h = heading.toLowerCase();
  if (/context|background|why/.test(h)) return `${title} answers a need the team keeps meeting. Goal: ${goal}.${cite}`;
  if (/requirement/.test(h)) return `1. The system supports ${topic}: ${goal}.\n2. Every outcome is visible to the person who triggered it.\n3. Failures are reported with a clear reason and never lose data.`;
  if (/acceptance|criteria/.test(h)) return `- [ ] A user can complete ${topic} end to end without help.\n- [ ] An invalid input is rejected with a message that names the problem.\n- [ ] The result is recorded and can be audited afterwards.`;
  if (/design|approach|solution/.test(h)) return `Keep the change small and local. ${title} is handled in one place, with the existing components doing the work and a single entry point for callers.${cite}`;
  if (/trade|alternative/.test(h)) return `Chosen: the simplest option that meets the goal. Rejected: a heavier design, which adds moving parts without a clear benefit today.`;
  if (/decision/.test(h)) return `We adopt the approach described for ${topic}: ${goal}.`;
  if (/consequence/.test(h)) return `Easier: one clear way to handle ${topic}. Harder: a later change of direction has to touch this decision.`;
  if (/definition/.test(h)) return `${title}: ${goal}.`;
  if (/responsib/.test(h)) return `Owns ${topic}. It does nothing else and delegates the rest.`;
  if (/interface/.test(h)) return `Inputs: the data needed for ${topic}. Outputs: a result and a status the caller can check.`;
  return `${title}: ${goal}.`;
}

function fill(prompt: string, title: string, goal: string): string {
  const note = tagged(prompt, "note")[0]?.text ?? "";
  const tpl = tagged(prompt, "template")[0]?.text ?? "";
  const ground = [...tagged(prompt, "linked"), ...tagged(prompt, "related")];
  const { fm, body } = splitFm(note);
  const have = sections(body);
  const wanted = sections(splitFm(tpl).body).items.map((s) => s.heading);
  const order = [...wanted, ...have.items.map((s) => s.heading).filter((h) => !wanted.includes(h))];
  const parts = [`${fm}\n# ${title}\n`];
  const intro = have.pre.replace(/^#.*\n?/m, "").trim();
  if (intro) parts.push(intro);
  order.forEach((heading, i) => {
    const mine = have.items.find((s) => s.heading === heading)?.text ?? "";
    const empty = !mine.replace(/^\s*-\s*\[ \]\s*$/gm, "").trim();
    parts.push(`## ${heading}\n\n${empty ? prose(heading, title, goal, i ? ground.slice(0, 2) : ground) : mine}`);
  });
  return `${parts.join("\n\n")}\n`;
}

function improve(prompt: string, title: string): string {
  const note = tagged(prompt, "note")[0]?.text ?? "";
  const linked = tagged(prompt, "linked");
  const { fm, body } = splitFm(note.replace(/\r\n/g, "\n"));
  let text = body.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!/^acceptance|^## +acceptance/im.test(text)) {
    text += `\n\n## Acceptance criteria\n\n${prose("acceptance criteria", title, "", [])}`;
  } else {
    // an empty checklist item gets a concrete one
    text = text.replace(/^(\s*)- \[ \]\s*$/m, `$1- [ ] The behaviour described above can be checked with one test per rule.`);
  }
  if (linked[0] && !text.includes("[[")) text += `\n\n## Related notes\n\n${linked.slice(0, 3).map((n) => `- [[${n.id}|related]]: ${n.title}`).join("\n")}`;
  return `${fm}${fm ? "\n" : ""}${text}\n`;
}

function note(system: string, prompt: string): string | null {
  if (!/You write and improve specification notes/.test(system)) return null;
  const title = /^Title: (.*)$/m.exec(prompt)?.[1]?.trim() || "Untitled";
  const instruction = tagged(prompt, "instruction")[0]?.text ?? "";
  const goal = firstSentence(instruction === DEFAULT_FILL ? "" : instruction).replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()) || `deliver what "${title}" describes`;
  return /^Task: improve/m.test(prompt) ? improve(prompt, title) : fill(prompt, title, goal);
}

// ---------------------------------------------------------------- smart search

function rewrite(question: string): string[] {
  const words = keywords(question);
  const out = [words.join(" "), `${words.slice(0, 3).join(" ")} specification`].map((q) => q.trim()).filter((q) => q && q !== question.trim().toLowerCase());
  return [...new Set(out)].slice(0, 2);
}

function structured(system: string, prompt: string): unknown {
  if (/turn a question into searches/.test(system)) return { queries: rewrite(/^Question: (.*)$/m.exec(prompt)?.[1] ?? ""), filters: {} };
  if (/order search results/.test(system)) return { order: Array.from({ length: (prompt.match(/^\d+\. /gm) ?? []).length }, (_, i) => i + 1) };
  return {};
}

/**
 * A language model that is not one: deterministic, offline, canned. For demos and screenshots only, and it is named so
 * everywhere it shows. It has no `model`, so features that need tool calling (deep search) stay off.
 */
export function createMockLlm(): Llm {
  return {
    id: MOCK_LLM_ID,
    async generate(system, prompt) {
      if (/^Question: /.test(prompt) && /\n\nSources:\n/.test(prompt)) return answerFrom(prompt);
      const written = note(system, prompt);
      if (written !== null) return written;
      if (/turn a question into searches|order search results/.test(system)) return JSON.stringify(structured(system, prompt));
      return "This is the demo model (mock): it only has canned answers for questions, search and note writing.";
    },
    async object<T>(system: string, prompt: string, schema: z.ZodType<T>): Promise<T> {
      return schema.parse(structured(system, prompt));
    },
  };
}
