import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_LOCAL_MODEL, createLocalEmbedder, evaluate, evaluateSearch, parseQuestions, providersFromEnv } from "@defluance/ai";
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

export async function queryCommand(vault: string, q: string, o: { type?: string | undefined; status?: string | undefined; limit?: number | undefined; mode?: string | undefined }, io: IO): Promise<number> {
  return withContext(vault, async (ctx) => {
    const filters = { type: o.type, status: o.status, limit: o.limit ?? 10 };
    let hits;
    if (o.mode === "smart") {
      const r = await services.smartSearchNotes(ctx, adminActor, q, filters);
      hits = r.hits;
      io.out(`understood as: ${r.understood.queries.join(" | ")}${Object.keys(r.understood.filters).length ? ` | filters ${JSON.stringify(r.understood.filters)}` : ""}${r.understood.fallback ? ` (${r.understood.fallback})` : ""}`);
    } else {
      if (o.mode && !["keyword", "meaning", "hybrid"].includes(o.mode)) {
        io.err(`unknown mode "${o.mode}" (keyword, meaning, hybrid, smart)`);
        return 2;
      }
      hits = await services.searchNotes(ctx, adminActor, q, { ...filters, mode: o.mode as "keyword" | "meaning" | "hybrid" | undefined });
    }
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

export async function evalCommand(vault: string, questionsFile: string, io: IO, o: { search?: boolean; mode?: string } = {}): Promise<number> {
  const root = resolve(vault);
  const { embedder, llm } = providersFromEnv();
  const store = await IndexStore.open(openSqlite(":memory:"));
  const schema = await loadSchema(root);
  await indexVault(store, { root, embedder, config: await loadConfig(root), linkTypes: schema.linkTypes, deferEmbeddings: false });
  if (o.search) {
    const mode = (o.mode ?? "hybrid") as "keyword" | "meaning" | "hybrid";
    const r = await evaluateSearch(store, parseQuestions(await readFile(resolve(questionsFile), "utf8")), { embedder, mode });
    for (const m of r.misses) io.out(`MISS  ${m.q}\n      got ${m.got.join(", ") || "nothing"}`);
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    io.out(`${mode}, ${embedder.model}: recall@1 ${pct(r.recallAt1)}, recall@3 ${pct(r.recallAt3)}, MRR ${r.mrr.toFixed(2)} over ${r.total} questions; ${r.noise.answered}/${r.noise.of} unanswerable questions still returned results`);
    await store.db.close();
    return 0;
  }
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

export async function modelsCommand(args: string[], io: IO): Promise<number> {
  const [sub, model] = args;
  if (sub !== "install") {
    io.err("usage: defluance models install [huggingface-model]   (default: " + DEFAULT_LOCAL_MODEL + ")");
    return 2;
  }
  const embedder = createLocalEmbedder(model || DEFAULT_LOCAL_MODEL, { autoInstall: true, log: (m) => io.err(m) });
  const t0 = performance.now();
  const [a, b] = await embedder.embed(["password reset link", "recovery email expires"]);
  const ms = Math.round(performance.now() - t0);
  io.out(`${embedder.model} ready: ${(a as Float32Array).length} dimensions, loaded and first embeddings in ${ms} ms`);
  io.out(`related text scores ${((a as Float32Array).reduce((s, x, i) => s + x * ((b as Float32Array)[i] as number), 0)).toFixed(2)}. Use it with: DFL_EMBED=${model ? `local:${model}` : "local"}`);
  return 0;
}
