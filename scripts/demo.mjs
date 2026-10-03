// `pnpm demo`: a populated local Defluance. Builds a throwaway "Acme Pay" vault with a believable git history,
// starts the server on it, then seeds live activity (agent tokens, drafts, a private note) through the REST API.
// Flags: --port N (or env PORT, default 4000), --plain (no LLM/GitHub mocks), --check (seed, assert, exit 0/1).
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_TOKEN, PASSPHRASE, buildVault, seedLive } from "./demo-seed.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const portArg = args.indexOf("--port");
const port = String(portArg >= 0 ? args[portArg + 1] : (process.env.PORT ?? 4000));
const plain = flag("plain");
const check = flag("check");
const base = `http://127.0.0.1:${port}`;

if (await fetch(`${base}/health`).then(() => true, () => false)) {
  console.error(`Le port ${port} est déjà utilisé. Essayez: pnpm demo --port <autre port>`);
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "dfl-demo-"));
const vault = join(tmp, "vault");
let child;
const cleanup = () => rmSync(tmp, { recursive: true, force: true });
const fail = (msg) => {
  console.error(`\nErreur: ${msg}`);
  child?.kill("SIGTERM");
  cleanup();
  process.exit(1);
};

console.log("Création du vault de démo (Acme Pay) et de son historique git...");
const count = buildVault(root, vault);
console.log(`  ${count} notes, historique sur environ 10 semaines`);

// The mock GitHub reads a file; shift its dates so the data looks fresh whenever the demo runs.
const nodes = JSON.parse(readFileSync(join(root, "fixtures/vault-showcase/github.json"), "utf8"));
const shift = Date.now() - Date.parse("2026-10-03T12:00:00Z");
const moved = (iso) => (iso ? new Date(Date.parse(iso) + shift).toISOString() : iso);
const githubFile = join(tmp, "github.json");
writeFileSync(githubFile, JSON.stringify(nodes.map((n) => ({ ...n, updated_at: moved(n.updated_at), merged_at: moved(n.merged_at) })), null, 2));

const env = {
  ...process.env,
  DFL_EMBED: "hash",
  DFL_RSA_BITS: "2048",
  DFL_ADMIN_TOKEN: ADMIN_TOKEN,
  DFL_RATE_LIMIT: "0",
  DFL_PUBLIC_URL: `http://localhost:${port}`,
  ...(plain ? {} : { DFL_LLM: "mock", DFL_GITHUB: "mock", DFL_GITHUB_MOCK_FILE: githubFile }),
};
let output = "";
child = spawn(process.execPath, [join(root, "packages/cli/dist/bin.js"), "serve", vault, "--ui", join(root, "apps/web/out"), "--port", port], { env, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (d) => (output += d));
child.stderr.on("data", (d) => (output += d));
let exited = false;
child.on("exit", (code) => {
  exited = true;
  cleanup();
  if (!check) process.exit(code ?? 0);
});
const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const get = async (path) => (await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } })).json();

// Wait for /health.
let health;
for (let i = 0; i < 40 && !health; i++) {
  if (exited) fail(`le serveur s'est arrêté au démarrage:\n${output.slice(-1500)}`);
  health = await fetch(`${base}/health`).then((r) => (r.ok ? r.json() : null)).catch((e) => { if (process.env.DEMO_DEBUG) console.error(e.cause ?? e); return null; });
  if (!health) await new Promise((r) => setTimeout(r, 500));
}
if (!health) fail(`le serveur ne répond pas sur /health:\n${output.slice(-1500)}`);
console.log(`Serveur prêt sur ${base}. Activité de démonstration via l'API :`);

let agents;
try {
  agents = await seedLive(base);
} catch (e) {
  fail(e.message);
}

if (check) {
  const problems = [];
  const stats = await get("/api/v1/stats");
  const drafts = await get("/api/v1/drafts");
  const h = await fetch(`${base}/health`).then((r) => r.json());
  const total = stats.total ?? Object.values(stats.by_type ?? stats.types ?? {}).reduce((a, b) => a + Number(b), 0);
  if (!(total >= 35)) problems.push(`notes: ${total} (< 35)`);
  const list = Array.isArray(drafts) ? drafts : (drafts.drafts ?? drafts.items ?? []);
  if (list.length < 3) problems.push(`drafts: ${list.length} (< 3)`);
  const gh = await fetch(`${base}/api/v1/github/nodes/acme/app/12`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
  if (plain ? gh.ok : !gh.ok) problems.push(`GitHub node #12: HTTP ${gh.status} (${plain ? "attendu absent sans mocks" : "attendu présent avec mocks"})`);
  if (!plain && !JSON.stringify(h).includes("mock")) problems.push(`/health ne signale pas les mocks: ${JSON.stringify(h)}`);
  if (!plain) {
    // the AI features answer for real (through the mock model), not only report that they exist
    const auth = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" };
    const gen = await fetch(`${base}/api/v1/notes/${encodeURIComponent("produit/partner-referrals")}/generate`, { method: "POST", headers: auth, body: JSON.stringify({ mode: "improve", instruction: "Make acceptance criteria testable" }) });
    const out = gen.ok ? await gen.json() : null;
    if (!out || out.model !== "mock:demo" || !/Acceptance criteria/i.test(out.content)) problems.push(`generate: HTTP ${gen.status}, ${out ? "unexpected content" : "no body"}`);
    const asked = await fetch(`${base}/api/v1/ask`, { method: "POST", headers: auth, body: JSON.stringify({ question: "How long is a password reset link valid?" }) });
    const answer = asked.ok ? await asked.json() : null;
    if (!answer?.citations?.length) problems.push(`ask: HTTP ${asked.status}, no citations`);
  }
  console.log(`\ncheck: ${total} notes, ${list.length} drafts, health=${JSON.stringify(h)}`);
  stop();
  await new Promise((r) => (exited ? r() : child.once("exit", r)));
  if (problems.length) {
    console.error(`check: ÉCHEC\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log("check: OK");
  process.exit(0);
}

console.log(`
============================================================
 Démo Defluance prête: Acme Pay (dépôt acme/app)
============================================================
 URL                  ${`http://localhost:${port}`}
 Token admin          ${ADMIN_TOKEN}   (à coller sur l'écran de connexion)
 Clé privée (admin)   passphrase: ${PASSPHRASE}   (la clé est verrouillée: testez le déverrouillage)
 Tokens d'agents      claude-code   ${agents["claude-code"]}   (lecture + écriture)
                      cursor-agent  ${agents["cursor-agent"]}   (lecture + écriture, produit et tech)
                      release-bot   ${agents["release-bot"]}   (lecture seule)
 À voir               Drafts (3 propositions d'agents, dont une en conflit), Historique, Lint (orphelins dont la note privée, 1 lien cassé),
                      graphe, note privée "Acquisition due diligence" (ops/), journal d'audit

 Ce qui est factice  ${plain ? "mode --plain: ni LLM ni GitHub simulés (recherche par mots-clés et par empreintes, pas de nœuds GitHub)" : "- LLM: réponses préparées (DFL_LLM=mock), pas un vrai modèle\n                      - GitHub: issues et PR fictives (DFL_GITHUB=mock)"}
                      - Embeddings: hachage (DFL_EMBED=hash), pas de vrai sens sémantique
 Données jetables: le vault est dans un dossier temporaire, supprimé à l'arrêt.

 Ctrl+C pour arrêter
============================================================
`);
