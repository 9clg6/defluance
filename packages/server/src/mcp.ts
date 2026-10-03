import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Actor } from "./auth.js";
import type { Ctx } from "./context.js";
import { HttpError } from "./errors.js";
import * as svc from "./services/index.js";

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => {
  const message = e instanceof HttpError ? `${e.message}${e.status === 422 && e.extra["errors"] ? ` ${JSON.stringify(e.extra["errors"])}` : ""}` : e instanceof Error ? e.message : String(e);
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
};

export const TOOL_NAMES = ["search", "read_note", "list_notes", "graph_neighbors", "graph_impact", "create_draft", "update_note", "link_notes", "create_issue", "ask"] as const;

/**
 * One MCP server per request, bound to the caller. Every tool goes through the same services as REST,
 * so scopes, spaces, commit mode and audit apply identically.
 */
export function buildMcpServer(ctx: Ctx, actor: Actor, onCall?: (tool: string, ok: boolean) => void): McpServer {
  const server = new McpServer({ name: "defluance", version: "0.1.0" });
  const tool = <S extends z.ZodRawShape>(name: (typeof TOOL_NAMES)[number], description: string, shape: S, run: (a: z.infer<z.ZodObject<S>>) => Promise<unknown>) => {
    server.registerTool(name, { description, inputSchema: shape }, (async (args: z.infer<z.ZodObject<S>>) => {
      try {
        const out = text(await run(args));
        onCall?.(name, true);
        return out;
      } catch (e) {
        onCall?.(name, false);
        return fail(e);
      }
    }) as never);
  };

  const filters = {
    type: z.string().optional().describe("note type, e.g. functional-spec"),
    status: z.string().optional().describe("draft, review, approved, implemented, deprecated"),
    space: z.string().optional(),
    tag: z.string().optional(),
  };

  tool("search", "Search the notes. mode keyword matches words, meaning compares vectors (when the server has an embedding model), hybrid (default) does both, smart lets a language model rewrite the question into several searches, infer filters and rerank, and reports what it understood.", {
    query: z.string().min(1), ...filters, limit: z.number().int().min(1).max(50).optional(),
    mode: z.enum(["keyword", "meaning", "hybrid", "smart"]).optional(), rerank: z.boolean().optional().describe("smart mode only: ask the model to order the results"),
    passages: z.number().int().min(1).max(5).optional().describe("passages returned per note"),
  }, (a) => {
    const f = { type: a.type, status: a.status, space: a.space, tag: a.tag, ...(a.limit ? { limit: a.limit } : {}), passages: a.passages };
    return a.mode === "smart" ? svc.smartSearchNotes(ctx, actor, a.query, { ...f, rerank: a.rerank }) : svc.searchNotes(ctx, actor, a.query, { ...f, mode: a.mode });
  });
  tool("read_note", "Read one note: frontmatter, markdown body and its typed links.", { id: z.string().describe("note id, the path without .md") }, async (a) => ({
    note: await svc.getNote(ctx, actor, a.id),
    links: await svc.noteLinks(ctx, actor, a.id),
  }));
  tool("list_notes", "List notes, optionally filtered.", { ...filters, limit: z.number().int().min(1).max(200).optional() }, (a) =>
    svc.listNotes(ctx, actor, { type: a.type, status: a.status, space: a.space, tag: a.tag, ...(a.limit ? { limit: a.limit } : {}) }),
  );
  tool("graph_neighbors", "Notes linked to a note, by direction (in, out, both), link type and depth (1 to 5).", {
    id: z.string(), direction: z.enum(["in", "out", "both"]).optional(), link: z.string().optional(), depth: z.number().int().min(1).max(5).optional(),
  }, (a) => svc.graphNeighborsOf(ctx, actor, a.id, a));
  tool("graph_impact", "Notes affected if this note changes: what depends on it or implements it, and their tests, plus tracking GitHub issues.", {
    id: z.string(), depth: z.number().int().min(1).max(5).optional(),
  }, (a) => svc.graphImpactOf(ctx, actor, a.id, a.depth));
  tool("create_draft", "Create a new note as a draft from the vault template. Agents write to a branch, never to the main branch, and cannot approve.", {
    title: z.string().min(1), type: z.string().describe("functional-spec, technical-spec, adr, note, glossary or component"),
    body: z.string().optional().describe("markdown body without the title"), id: z.string().optional().describe("path without .md, defaults to the slugified title"),
    frontmatter: z.record(z.string(), z.string()).optional(),
  }, (a) => svc.createNote(ctx, actor, { title: a.title, type: a.type, body: a.body, id: a.id, frontmatter: a.frontmatter }));
  tool("update_note", "Replace a note with new full markdown (frontmatter included). Pass base_commit from read_note to avoid overwriting concurrent edits.", {
    id: z.string(), content: z.string(), base_commit: z.string().optional(), message: z.string().optional(),
  }, (a) => svc.updateNote(ctx, actor, a.id, { content: a.content, baseCommit: a.base_commit, message: a.message }));
  tool("link_notes", "Add a typed link from a note to another note or to a GitHub issue (gh:owner/repo#12).", {
    from: z.string(), to: z.string(), type: z.string().describe("implements, depends_on, supersedes, tested_by, tracked_by, blocks, related"),
  }, (a) => svc.addLink(ctx, actor, a.from, { to: a.to, type: a.type }));
  tool("create_issue", "Open a GitHub issue from a note and link it back as tracked_by.", {
    id: z.string(), repo: z.string().optional().describe("owner/repo, defaults to the space repository"), title: z.string().optional(), body: z.string().optional(), labels: z.array(z.string()).optional(),
  }, (a) => svc.createIssueFromNote(ctx, actor, a.id, a));
  tool("ask", "Answer a question from the notes. Every answer cites the notes it used, and the tool refuses when nothing supports an answer. deep lets the server's model search, read notes and follow links over several steps, for questions that span several specs.", {
    question: z.string().min(1), ...filters, deep: z.boolean().optional(),
  }, (a) => svc.askQuestion(ctx, actor, a.question, { type: a.type, status: a.status, space: a.space, tag: a.tag, deep: a.deep }));
  return server;
}
