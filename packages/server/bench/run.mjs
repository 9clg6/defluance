// Benchmark on a synthetic vault. Thresholds come from the PRD (NFR-001, NFR-002).
// Usage: pnpm --filter @defluance/server bench   (BENCH_NOTES=10000 by default)
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashEmbedder } from "@defluance/shared";
import { createApp, createContext, indexNow } from "@defluance/server";

const N = Number(process.env.BENCH_NOTES ?? 10_000);
const LIMITS = { searchP95: 300, readP95: 100, incremental: 5_000, fullIndex: 10 * 60_000 };

// deterministic PRNG so runs are comparable
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rand() * a.length)];
const vocab = Array.from({ length: 3000 }, (_, i) => `w${(i * 2654435761 >>> 0).toString(36)}`);
const topics = ["authentication", "billing", "invoice", "session", "webhook", "retention", "permission", "notification", "search", "export"];

const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))];
const time = async (fn) => {
  const t = performance.now();
  await fn();
  return performance.now() - t;
};

const root = await mkdtemp(join(tmpdir(), "dfl-bench-"));
const rows = [];
let failed = false;
const row = (name, value, unit, limit) => {
  const ok = limit === undefined || value <= limit;
  if (!ok) failed = true;
  rows.push(`${ok ? "ok  " : "FAIL"}  ${name.padEnd(34)} ${value.toFixed(value < 10 ? 1 : 0).padStart(8)} ${unit}${limit === undefined ? "" : `   (limit ${limit})`}`);
};

try {
  console.log(`Generating ${N} notes...`);
  const t0 = performance.now();
  const ids = Array.from({ length: N }, (_, i) => `area-${i % 20}/note-${i}`);
  await Promise.all(Array.from({ length: 20 }, (_, d) => mkdir(join(root, `area-${d}`), { recursive: true })));
  for (let i = 0; i < N; i += 200) {
    await Promise.all(
      ids.slice(i, i + 200).map((id, j) => {
        const topic = pick(topics);
        const para = () => Array.from({ length: 60 }, () => pick(vocab)).join(" ");
        const links = Array.from({ length: 3 }, () => `[[${pick(ids)}|${pick(["related", "depends_on", "implements"])}]]`).join(" ");
        const body = `# Note ${i + j} about ${topic}\n\n${topic} ${para()}\n\n## Details\n\n${para()} ${links}\n\n## More\n\n${para()}\n`;
        return writeFile(join(root, `${id}.md`), `---\ntype: ${pick(["functional-spec", "technical-spec", "note"])}\nstatus: ${pick(["draft", "review", "approved"])}\nowner: bench\ntags: [${topic}]\nacceptance_criteria: []\n---\n${body}`);
      }),
    );
  }
  const git = (...a) => execFileSync("git", ["-C", root, "-c", "user.name=b", "-c", "user.email=b@b", ...a], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "bench");
  console.log(`  generated in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

  const ctx = await createContext({ root, env: { DFL_SESSION_SECRET: "bench-secret-bench-secret", DFL_RATE_LIMIT: "0" }, embedder: hashEmbedder(), llm: null, log: false });
  const { app } = createApp(ctx);
  const { token } = await ctx.sys.createToken({ name: "bench", scopes: ["read", "write", "issues", "admin"], spaces: [], createdBy: "bench" });
  const get = (path) => app.request(path, { headers: { authorization: `Bearer ${token}` } });

  row("full index (hash embeddings)", await time(() => indexNow(ctx)), "ms", LIMITS.fullIndex);
  row("re-scan, nothing changed", await time(() => indexNow(ctx)), "ms");

  // incremental: one note changed on disk
  const changed = pick(ids);
  await writeFile(join(root, `${changed}.md`), `---\ntype: note\nstatus: draft\nowner: bench\n---\n# Changed\n\nbrand new words zebrafish.\n`);
  row("incremental, 1 note", await time(() => indexNow(ctx, [`${changed}.md`])), "ms", LIMITS.incremental);

  await get("/api/v1/search?q=warmup");
  const searches = [];
  for (let i = 0; i < 200; i++) searches.push(await time(() => get(`/api/v1/search?q=${pick(topics)}+${pick(vocab)}+${pick(vocab)}`).then((r) => r.text())));
  row("search p50", quantile(searches, 0.5), "ms");
  row("search p95 (hybrid, REST)", quantile(searches, 0.95), "ms", LIMITS.searchP95);

  const filtered = [];
  for (let i = 0; i < 100; i++) filtered.push(await time(() => get(`/api/v1/search?q=${pick(topics)}&type=technical-spec&status=approved&tag=${pick(topics)}`).then((r) => r.text())));
  row("search p95 with filters", quantile(filtered, 0.95), "ms", LIMITS.searchP95);

  const reads = [];
  for (let i = 0; i < 200; i++) reads.push(await time(() => get(`/api/v1/notes/${encodeURIComponent(pick(ids))}`).then((r) => r.text())));
  row("read note p50", quantile(reads, 0.5), "ms");
  row("read note p95 (REST)", quantile(reads, 0.95), "ms", LIMITS.readP95);

  const graph = [];
  for (let i = 0; i < 100; i++) graph.push(await time(() => get(`/api/v1/graph/neighbors?id=${encodeURIComponent(pick(ids))}&depth=2`).then((r) => r.text())));
  row("graph neighbors p95 (depth 2)", quantile(graph, 0.95), "ms");

  const counts = await ctx.store.counts();
  console.log(`\n${counts.notes} notes, ${counts.chunks} chunks, ${counts.edges} links\n`);
  console.log(rows.join("\n"));
  await ctx.close();
} finally {
  await rm(root, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
