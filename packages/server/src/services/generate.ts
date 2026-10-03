import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GenerateError, generateNote, type ContextNote, type GenerateMode } from "@defluance/ai";
import { search as indexSearch, type NoteRow } from "@defluance/indexer";
import { bodyOf, parseNote, renderTemplate } from "@defluance/vault-core";
import { type Actor } from "../auth.js";
import { type Ctx } from "../context.js";
import { HttpError, forbidden } from "../errors.js";
import { isPrivateRow, readPrivate } from "./private.js";
import { graphNeighborsOf } from "./search.js";
import { audit, readSpaces, requireNote } from "./shared.js";

const EXCERPT = 1200;
const LINKED = 6;
const RELATED = 4;

/** A plain note's text, cut. Private notes are never context: the model must not see text its reader did not choose to send. */
async function excerptOf(ctx: Ctx, row: NoteRow): Promise<ContextNote | null> {
  if (isPrivateRow(row)) return null;
  const raw = await readFile(join(ctx.root, row.path), "utf8").catch(() => null);
  if (raw === null) return null;
  return { id: row.id, title: row.title, excerpt: bodyOf(raw).trim().slice(0, EXCERPT) };
}

export interface GenerateInput {
  mode: GenerateMode;
  instruction?: string | undefined;
  /** Unsaved editor text. It replaces the stored text as the input. */
  content?: string | undefined;
}

/**
 * Propose a filled-in or improved version of a note. Nothing is written, committed or indexed: the caller shows the text
 * and the person decides. The rules that make the text safe (valid frontmatter, status and owner unchanged, no links to
 * notes that do not exist) are applied to the returned text by `generateNote`, not left to the prompt.
 */
export async function generateForNote(ctx: Ctx, actor: Actor, id: string, input: GenerateInput) {
  // Same right as an update, and never for programs: a person asks for a draft and reads it.
  if (actor.agent) throw forbidden("agents cannot generate note text");
  const note = await requireNote(ctx, actor, id, "write");
  const llm = ctx.llm;
  if (!llm) throw new HttpError(503, "no language model configured: set DFL_LLM");

  let stored: string;
  if (isPrivateRow(note)) {
    // The text of a private note reaches the model provider only if the operator allowed it and its reader has unlocked it.
    if (!ctx.privateLlm) throw new HttpError(422, "this note is private and the language model may not read private notes (the operator can allow it with DFL_PRIVATE_LLM=allow)");
    stored = (await readPrivate(ctx, actor, note)).plain;
  } else {
    stored = await readFile(join(ctx.root, note.path), "utf8").catch(() => {
      throw new HttpError(404, "note not found");
    });
  }
  const text = input.content ?? stored;
  const schema = await ctx.getSchema();
  const readable = await readSpaces(ctx, actor);

  // Context, through the same permissions as every read: linked notes the actor can see, then a few found by search.
  const grounded: ContextNote[] = [];
  const linked: ContextNote[] = [];
  const near = await graphNeighborsOf(ctx, actor, note.id, { depth: 1 });
  for (const n of near.nodes) {
    if (n.id === note.id || linked.length >= LINKED) continue;
    const row = await ctx.store.getNote(n.id);
    const c = row && (await excerptOf(ctx, row));
    if (c) linked.push(c);
  }
  // Plain index search on purpose, not `searchNotes`: that one merges the decrypted notes of unlocked keys.
  const related: ContextNote[] = [];
  const hits = await indexSearch(ctx.store, `${note.title} ${input.instruction ?? ""}`.trim().slice(0, 300), { spaces: readable, embedder: ctx.embedder, limit: RELATED + LINKED + 1 });
  for (const h of hits) {
    if (h.note.id === note.id || linked.some((l) => l.id === h.note.id) || related.length >= RELATED) continue;
    const row = await ctx.store.getNote(h.note.id);
    const c = row && (await excerptOf(ctx, row));
    if (c) related.push(c);
  }
  grounded.push(...linked, ...related);

  const template = await renderTemplate(ctx.root, { type: note.type ?? "note", title: note.title, owner: note.owner ?? "" }, { hints: true }).catch(() => null);

  // Which notes a link may point to: those the actor can read, never a private one the model could not have seen.
  const graph = await ctx.store.graph();
  const privateIds = new Set((await ctx.store.encryptedNotes()).map((n) => n.id));
  const visible = [...graph.nodes.values()].filter((n) => (!readable || readable.includes(n.space)) && !privateIds.has(n.id)).map((n) => n.id);
  const byName = (t: string) => {
    if (visible.includes(t)) return t;
    const same = visible.filter((v) => v.split("/").at(-1) === t);
    return same.length === 1 ? (same[0] as string) : null;
  };
  const linkTypes = schema.linkTypes;
  let result;
  try {
    result = await generateNote(
      llm,
      {
        mode: input.mode,
        instruction: input.instruction,
        note: { id: note.id, title: note.title, text },
        original: { type: note.type, status: note.status, owner: note.owner },
        template,
        schema: { types: Object.keys(schema.types).filter((t) => t !== "issue" && t !== "pull-request"), statuses: schema.statuses, linkTypes },
        linked,
        related,
      },
      {
        parse: (t) => parseNote(note.path, t, { linkTypes }),
        resolve: async (l) => (l.kind === "github" ? ((await ctx.store.ghNode(l.target.replace(/^gh:/, ""))) ? l.target : null) : byName(l.target)),
      },
    );
  } catch (e) {
    if (e instanceof GenerateError) throw new HttpError(422, e.message);
    throw new HttpError(502, `the language model failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // No text in the audit log: only what was asked, and of which model.
  await audit(ctx, actor, "note.generate", note.id, { mode: input.mode, model: llm.id });
  return { content: result.content, model: llm.id, grounded_on: grounded.map((g) => ({ id: g.id, title: g.title })), links: result.links, warnings: result.warnings };
}
