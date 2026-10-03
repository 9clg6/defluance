import { isStepCount, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import { neighbors, search, type IndexStore } from "@defluance/indexer";
import { ask, NO_SOURCE, type AskOptions, type AskResult, type Citation } from "./ask.js";

export interface DeepAskOptions extends AskOptions {
  /** Tool-calling rounds before the agent must answer. */
  maxSteps?: number;
}

interface Source {
  n: number;
  chunkId: string;
  noteId: string;
  title: string;
  heading: string;
  commit: string | null;
  content: string;
}

const SYSTEM = [
  "You research a question in a team's vault of specifications, decisions and notes, using the tools.",
  "Search more than once with different words, also in the other language if the notes may be in it. Read a note when its passages are not enough, and follow links with neighbors when a spec depends on another.",
  "Every passage you are given has a number like [3]. Answer ONLY from those passages and cite the numbers after each claim, like [1] or [2][3].",
  "If the passages do not contain the answer, reply with exactly: NO_SOURCE",
  "Answer in the language of the question, concisely.",
].join(" ");

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * An agent that does the searching: it searches, reads notes and follows links with tools, then answers.
 * Citations can only be passages the tools returned, so the answer stays checkable. Needs a model that supports tools;
 * otherwise this is a normal `ask`.
 */
export async function deepAsk(store: IndexStore, question: string, opts: DeepAskOptions = {}): Promise<AskResult> {
  const llm = opts.llm;
  if (!llm?.model) return ask(store, question, opts);

  const maxSteps = Math.min(Math.max(opts.maxSteps ?? 6, 2), 10);
  const sources: Source[] = [];
  const byChunk = new Map<string, Source>();
  const steps: NonNullable<AskResult["steps"]> = [];

  const visible = (n: { space: string; id: string }) => (!opts.spaces || opts.spaces.includes(n.space)) && (!opts.ids || opts.ids.includes(n.id));

  const register = (c: { id: string; note_id: string; title: string; heading: string; content: string; commit_sha: string | null }): Source => {
    const known = byChunk.get(c.id);
    if (known) return known;
    const s: Source = { n: sources.length + 1, chunkId: c.id, noteId: c.note_id, title: c.title, heading: c.heading, commit: c.commit_sha, content: c.content };
    sources.push(s);
    byChunk.set(c.id, s);
    return s;
  };
  const render = (s: Source, max: number) => `[${s.n}] ${s.title} > ${s.heading} (${s.noteId})\n${short(s.content, max)}`;

  const filter = { space: opts.space, spaces: opts.spaces, type: opts.type, status: opts.status, tag: opts.tag, owner: opts.owner, ids: opts.ids };

  const tools = {
    search: tool({
      description: "Search the vault by words and meaning. Returns numbered passages.",
      inputSchema: z.object({ query: z.string().min(1), type: z.string().optional(), status: z.string().optional() }),
      execute: async ({ query, type, status }) => {
        const hits = await search(store, query, { ...filter, type: filter.type ?? type, status: filter.status ?? status, embedder: opts.embedder ?? null, limit: 6 });
        const rows = hits.length
          ? await store.db.all<{ id: string; note_id: string; title: string; heading: string; content: string; commit_sha: string | null }>(
              `SELECT id, note_id, title, heading, content, commit_sha FROM chunks WHERE id IN (${hits.map(() => "?").join(", ")})`,
              hits.map((h) => h.chunk.id),
            )
          : [];
        const byId = new Map(rows.map((r) => [r.id, r]));
        const out = hits.flatMap((h) => {
          const r = byId.get(h.chunk.id);
          return r ? [render(register(r), 700)] : [];
        });
        steps.push({ tool: "search", input: query, summary: `${out.length} passage${out.length === 1 ? "" : "s"}` });
        return out.length ? out.join("\n\n") : "No matching passage.";
      },
    }),
    read_note: tool({
      description: "Read the passages of one note, by its id.",
      inputSchema: z.object({ id: z.string().min(1) }),
      execute: async ({ id }) => {
        const note = await store.getNote(id);
        if (!note || !visible(note)) {
          steps.push({ tool: "read_note", input: id, summary: "not found" });
          return "No such note.";
        }
        const rows = await store.db.all<{ id: string; note_id: string; title: string; heading: string; content: string; commit_sha: string | null }>(
          "SELECT id, note_id, title, heading, content, commit_sha FROM chunks WHERE note_id = ? ORDER BY ordinal LIMIT 8",
          [id],
        );
        steps.push({ tool: "read_note", input: note.id, summary: note.title });
        return rows.map((r) => render(register(r), 1500)).join("\n\n") || "This note is empty.";
      },
    }),
    neighbors: tool({
      description: "List the notes linked to a note (both directions) with the link type.",
      inputSchema: z.object({ id: z.string().min(1) }),
      execute: async ({ id }) => {
        const root = await store.getNote(id);
        if (!root || !visible(root)) {
          steps.push({ tool: "neighbors", input: id, summary: "not found" });
          return "No such note.";
        }
        const g = await neighbors(store, id, { spaces: opts.spaces, depth: 1 });
        const lines = g.edges
          .filter((e) => e.from === id || e.to === id)
          .map((e) => {
            const other = e.from === id ? e.to : e.from;
            const n = g.nodes.find((x) => x.id === other);
            return n && (!opts.ids || opts.ids.includes(n.id)) ? `${e.from === id ? "→" : "←"} ${e.type}: ${n.id} (${n.title})` : null;
          })
          .filter((x): x is string => !!x);
        steps.push({ tool: "neighbors", input: id, summary: `${lines.length} link${lines.length === 1 ? "" : "s"}` });
        return lines.join("\n") || "No links.";
      },
    }),
  };

  let text: string;
  try {
    const agent = new ToolLoopAgent({
      model: llm.model,
      instructions: SYSTEM,
      tools,
      temperature: 0,
      maxRetries: 2,
      stopWhen: isStepCount(maxSteps),
      // the last round may not call tools: the agent must answer with what it found
      prepareStep: ({ stepNumber }) => (stepNumber >= maxSteps - 1 ? { toolChoice: "none" as const } : undefined),
    });
    const result = await agent.generate({ prompt: question });
    text = result.text.trim();
  } catch (e) {
    // a model without tool support, or a provider error: fall back to the single-pass answer
    const fallback = await ask(store, question, opts);
    return { ...fallback, steps: steps.length ? steps : [{ tool: "error", input: "", summary: e instanceof Error ? e.message : String(e) }] };
  }

  const refuse = (): AskResult => ({ answer: NO_SOURCE, citations: [], refused: true, mode: "deep", steps });
  if (!text || /^NO_SOURCE\b/.test(text)) return refuse();

  const used: number[] = [];
  const cleaned = text.replace(/\[(\d+)\]/g, (m, d: string) => {
    const n = Number(d);
    if (n < 1 || n > sources.length) return ""; // a number the tools never returned
    if (!used.includes(n)) used.push(n);
    return m;
  });
  if (!used.length) return refuse();

  const citations: Citation[] = used.map((n) => {
    const s = sources[n - 1] as Source;
    return { n, note: s.noteId, title: s.title, heading: s.heading, commit: s.commit, snippet: short(s.content.replace(/\s+/g, " "), 240) };
  });
  return { answer: cleaned.replace(/[ \t]+([.,;:])/g, "$1").trim(), citations, refused: false, mode: "deep", steps };
}
