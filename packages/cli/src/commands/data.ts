import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluate, parseQuestions, providersFromEnv } from "@defluance/ai";
import { IndexStore, indexVault, openSqlite } from "@defluance/indexer";
import { githubFromEnv, indexNow, PERMS, services, type Perm } from "@defluance/server";
import { loadConfig, loadSchema } from "@defluance/vault-core";
import { withContext, type IO } from "./runtime.js";

export async function indexCommand(vault: string, rebuild: boolean, io: IO): Promise<number> {
  return withContext(
    vault,
    async (ctx) => {
      if (rebuild) for (const t of ["chunks", "edges", "notes", "embedding_cache", "meta"]) await ctx.db.run(`DELETE FROM ${t}`);
      await indexNow(ctx);
      const s = await services.indexStatus(ctx);
      io.out(`${s.notes} notes, ${s.chunks} chunks, ${s.edges} links, ${s.embedded} embedded (${s.embed_model || "full-text only"})`);
      return 0;
    },
    { index: false },
  );
}

export async function queryCommand(vault: string, q: string, o: { type?: string | undefined; status?: string | undefined; limit?: number | undefined }, io: IO): Promise<number> {
  return withContext(vault, async (ctx) => {
    const hits = await services.searchNotes(ctx, adminActor, q, { type: o.type, status: o.status, limit: o.limit ?? 10 });
    if (!hits.length) io.out("no results");
    for (const h of hits) io.out(`${h.note.id}  [${h.note.type ?? "?"}/${h.note.status ?? "?"}]  ${h.chunk.heading}\n    ${h.chunk.snippet}`);
    return 0;
  });
}

const adminActor = { kind: "user" as const, id: "cli", name: "cli", agent: false, grants: [{ space: "*", perms: new Set(PERMS) }] };

export async function tokenCommand(vault: string, args: string[], o: { scopes?: string | undefined; spaces?: string | undefined; expires?: number | undefined }, io: IO): Promise<number> {
  const [sub, arg] = args;
  return withContext(
    vault,
    async (ctx) => {
      if (sub === "create") {
        if (!arg) {
          io.err("usage: defluance token create <name> [--scopes read,write] [--spaces a,b] [--expires days]");
          return 2;
        }
        const scopes = (o.scopes ?? "read").split(",").map((s) => s.trim()).filter(Boolean) as Perm[];
        const spaces = (o.spaces ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const t = await services.createToken(ctx, { ...adminActor, name: "cli" }, { name: arg, scopes, spaces, ...(o.expires ? { expiresInDays: o.expires } : {}) });
        io.out(t.token);
        io.err(`token "${t.name}" created (scopes: ${t.scopes.join(", ")}; spaces: ${t.spaces.join(", ") || "all"}). It is shown once.`);
        return 0;
      }
      if (sub === "list") {
        for (const t of await ctx.sys.listTokens()) io.out(`${t.id}  ${t.name}  [${t.scopes.join(",")}]  spaces: ${t.spaces.join(",") || "all"}  last used: ${t.last_used_at ?? "never"}`);
        return 0;
      }
      if (sub === "revoke" && arg) {
        await services.revokeToken(ctx, adminActor, arg);
        io.out("revoked");
        return 0;
      }
      io.err("usage: defluance token <create|list|revoke> ...");
      return 2;
    },
    { index: false },
  );
}

export async function evalCommand(vault: string, questionsFile: string, io: IO): Promise<number> {
  const root = resolve(vault);
  const { embedder, llm } = providersFromEnv();
  const store = await IndexStore.open(openSqlite(":memory:"));
  const schema = await loadSchema(root);
  await indexVault(store, { root, embedder, config: await loadConfig(root), linkTypes: schema.linkTypes });
  const report = await evaluate(store, parseQuestions(await readFile(resolve(questionsFile), "utf8")), { embedder, llm });
  for (const f of report.failures) io.out(`FAIL  ${f.q}\n      ${f.reason}`);
  io.out(`${report.passed}/${report.total} passed, ${report.validCitations}/${report.answered} answers with valid citations (${llm?.id ?? "extractive"}, ${embedder.model})`);
  await store.db.close();
  return report.failures.length ? 1 : 0;
}

export async function resyncGithub(vault: string, io: IO): Promise<number> {
  return withContext(vault, async (ctx) => {
    const gh = githubFromEnv(ctx, process.env);
    if (!gh) {
      io.err("GitHub is not configured: set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET");
      return 1;
    }
    const r = await gh.resync();
    io.out(`${r.issues} issues, ${r.pulls} pull requests`);
    return 0;
  });
}
