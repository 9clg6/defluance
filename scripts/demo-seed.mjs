// Pieces of `pnpm demo`: the git history of the demo vault, and the live activity seeded through the REST API.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PEOPLE = {
  nadia: "Nadia Haddad",
  clement: "Clement Laurent",
  sam: "Sam Okafor",
  priya: "Priya Nair",
  lea: "Lea Fontaine",
  karim: "Karim Benali",
};

/*
 * History plan. Each step: [days ago, author, message, notes written]. A note is [id, status, cut]:
 * `status` overrides the frontmatter status ("=" keeps the final one), `cut` writes it without its last section,
 * as if it was still being written. Notes never mentioned are added at the end by their owner.
 */
const D = "draft", R = "review", A = "approved", I = "implemented", F = "=";
const STEPS = [
  [70, "nadia", "init: workspace readme and glossary", [["readme", D], ["tech/glossary", D, 1]]],
  [68, "karim", "draft: auth login spec", [["produit/auth-login", D, 1], ["tech/sessions", D, 1], ["tech/adr-0001-jwt-sessions", D]]],
  [66, "karim", "propose ADR 0001: signed tokens for sessions", [["tech/adr-0001-jwt-sessions", R]]],
  [64, "nadia", "review feedback on login spec", [["produit/auth-login", R]]],
  [63, "karim", "approve ADR 0001", [["tech/adr-0001-jwt-sessions", A], ["tech/sessions", R]]],
  [61, "clement", "sessions: storage section, approve", [["tech/sessions", A], ["tech/auth-module", D], ["produit/roles-permissions", D, 1]]],
  [59, "karim", "roles and permissions: ready for review", [["produit/roles-permissions", R]]],
  [57, "nadia", "draft: password reset", [["produit/password-reset", D]]],
  [56, "lea", "draft: refund policy", [["produit/refunds", D, 1], ["produit/billing-invoices", D, 1]]],
  [55, "karim", "login shipped, mark implemented", [["produit/auth-login", I], ["tech/auth-module", A], ["produit/roles-permissions", A]]],
  [54, "clement", "ADR 0002: Redis for background jobs", [["tech/adr-0002-redis-job-queue", A]]],
  [52, "sam", "draft: hosted checkout and payment service", [["produit/checkout", D, 1], ["tech/payment-service", D, 1]]],
  [50, "clement", "approve billing invoices, start ledger spec", [["produit/billing-invoices", A], ["tech/ledger", D, 1], ["tech/adr-0004-double-entry-ledger", D]]],
  [48, "clement", "ADR 0004: double-entry ledger approved", [["tech/adr-0004-double-entry-ledger", A], ["tech/ledger", R]]],
  [46, "nadia", "checkout spec: review feedback", [["produit/checkout", R]]],
  [44, "sam", "draft: PSP integration and idempotency", [["tech/psp-integration", D], ["tech/idempotency", D], ["tech/adr-0006-psp-abstraction", D]]],
  [43, "clement", "postmortem for the 19 August PSP timeouts", [["ops/incident-2026-08-psp-timeout", A]]],
  [42, "lea", "draft: invoice lifecycle and credit notes", [["produit/invoice-lifecycle", D, 1], ["produit/credit-notes", D]]],
  [40, "karim", "webhooks: first draft, rate limits", [["tech/webhooks", D, 1], ["tech/rate-limiting", D, 1], ["tech/adr-0005-transactional-outbox", D]]],
  [38, "clement", "approve ADR 0005 outbox, payment service", [["tech/adr-0005-transactional-outbox", A], ["tech/payment-service", A], ["tech/ledger", A], ["tech/webhooks", R]]],
  [36, "sam", "ADR 0003: move the job queue to Postgres", [["tech/adr-0003-postgres-job-queue", A], ["tech/adr-0002-redis-job-queue", "deprecated"], ["tech/job-queue", D, 1]]],
  [34, "sam", "job queue: semantics and capacity", [["tech/job-queue", A], ["tech/psp-integration", R], ["tech/idempotency", A]]],
  [32, "lea", "review feedback on refund policy", [["produit/refunds", R], ["produit/invoice-lifecycle", R], ["produit/credit-notes", R]]],
  [31, "priya", "dunning kickoff notes", [["produit/meetings/2026-09-02-dunning-kickoff", A], ["produit/dunning", D, 1]]],
  [30, "nadia", "approve checkout spec, add test plan", [["produit/checkout", A], ["tech/test-plan-checkout", A], ["tech/components/checkout-ui", D]]],
  [28, "sam", "checkout ships: mark implemented", [["produit/checkout", I], ["tech/payment-service", I], ["tech/components/checkout-ui", I], ["tech/job-queue", I], ["tech/idempotency", I], ["tech/adr-0003-postgres-job-queue", I]]],
  [27, "nadia", "readme and glossary: point to the new specs", [["readme", A], ["tech/glossary", F]]],
  [26, "lea", "approve invoice lifecycle, credit notes and refunds", [["produit/invoice-lifecycle", A], ["produit/credit-notes", A], ["produit/refunds", A], ["tech/components/billing-engine", D]]],
  [24, "clement", "ledger and billing engine implemented", [["tech/ledger", I], ["tech/components/ledger-service", I], ["tech/components/billing-engine", I], ["produit/invoice-lifecycle", I], ["produit/credit-notes", I]]],
  [22, "priya", "draft: multi-currency and tax handling", [["produit/multi-currency", D, 1], ["produit/tax-handling", D, 1]]],
  [20, "priya", "draft: metered billing, v1", [["produit/metered-billing-v1", A]]],
  [19, "nadia", "draft: notifications and SAML SSO", [["produit/notifications", D], ["produit/sso-saml", D, 1]]],
  [18, "clement", "notes from the ledger review with finance", [["tech/meetings/2026-09-15-ledger-review", A]]],
  [17, "karim", "webhook dispatcher shipped", [["tech/webhooks", I], ["tech/components/webhook-dispatcher", I], ["tech/rate-limiting", R], ["produit/password-reset", R]]],
  [15, "sam", "runbook: webhook backlog; data retention", [["ops/runbook-webhook-backlog", A], ["tech/data-retention", D], ["tech/psp-integration", A]]],
  [14, "clement", "runbook: ledger reconciliation", [["ops/runbook-ledger-reconciliation", A], ["tech/observability", D, 1]]],
  [12, "priya", "metered billing replaced by usage-based billing", [["produit/metered-billing-v1", "deprecated"], ["produit/usage-based-billing", D]]],
  [11, "priya", "multi-currency approved", [["produit/multi-currency", A], ["produit/dunning", R], ["produit/payment-retries", D]]],
  [9, "sam", "observability SLOs and the payment volume chart", [["tech/observability", A], ["tech/data-retention", A], ["attachments/payment-volume.png"]]],
  [8, "lea", "tax handling: reverse charge rules", [["produit/tax-handling", R], ["tech/adr-0006-psp-abstraction", R]]],
  [6, "priya", "dunning approved after kickoff decisions", [["produit/dunning", A], ["produit/payment-retries", R], ["produit/usage-based-billing", R]]],
  [5, "nadia", "SAML SSO: review feedback", [["produit/sso-saml", R], ["produit/notifications", A]]],
  [3, "sam", "audit export: first draft", [["produit/audit-export", D]]],
  [2, "priya", "parking an idea: partner referrals", [["produit/partner-referrals", D]]],
];

const stamp = (daysAgo, i) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  d.setUTCHours(8 + ((i * 5) % 9), (i * 17) % 60, 0, 0);
  return d.toISOString();
};

/** Walk a directory and return files relative to it. */
const walk = (dir, rel = "") =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, join(rel, e.name)) : [join(rel, e.name)],
  );

/** Copy vault-demo, overlay vault-showcase (minus github.json) and give it a believable git history. */
export function buildVault(root, dest) {
  const src = join(dest, "..", "src");
  rmSync(src, { recursive: true, force: true });
  cpSync(join(root, "fixtures/vault-demo"), src, { recursive: true });
  cpSync(join(root, "fixtures/vault-showcase"), src, { recursive: true, filter: (p) => !p.endsWith("github.json") });
  mkdirSync(dest, { recursive: true });
  const git = (env, ...a) => execFileSync("git", ["-C", dest, "-c", "commit.gpgsign=false", ...a], { env: { ...process.env, ...env }, stdio: "pipe" });
  git({}, "init", "-q", "-b", "main");

  const final = new Map(); // path -> final text (notes) or buffer (assets)
  for (const f of walk(src)) final.set(f, readFileSync(join(src, f)));
  const ids = [...final.keys()].filter((f) => f.endsWith(".md") && !f.startsWith(".")).map((f) => f.slice(0, -3));
  const owner = (id) => /^owner:\s*(\S+)/m.exec(final.get(`${id}.md`).toString())?.[1] ?? "clement";

  const render = (id, status, cut) => {
    let t = final.get(`${id}.md`).toString();
    if (status && status !== F) t = t.replace(/^status: .*$/m, `status: ${status}`);
    if (cut) {
      const i = t.lastIndexOf("\n## ");
      if (i > 0) t = `${t.slice(0, i).trimEnd()}\n`;
    }
    return t;
  };
  const write = (path, data) => {
    mkdirSync(dirname(join(dest, path)), { recursive: true });
    writeFileSync(join(dest, path), data);
  };
  const commit = (who, daysAgo, i, msg) => {
    git({}, "add", "-A");
    if (!git({}, "status", "--porcelain").length) return;
    const when = stamp(daysAgo, i);
    const name = PEOPLE[who] ?? who;
    const email = `${who}@acme-pay.example`;
    git({ GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }, "commit", "-q", "-m", msg);
  };

  // Config and the schema defaults come with the very first commit.
  write(".defluance/config.yaml", final.get(".defluance/config.yaml"));
  const seen = new Set();
  STEPS.forEach(([d, who, msg, notes], i) => {
    for (const [id, status, cut] of notes) {
      if (id.includes(".")) write(id, final.get(id));
      else {
        write(`${id}.md`, render(id, status, cut));
        seen.add(id);
      }
    }
    commit(who, d, i, msg);
  });
  // Notes the plan does not mention, then anything still different from the overlay: one commit by their owner.
  ids.filter((id) => !seen.has(id)).forEach((id, i) => {
    write(`${id}.md`, final.get(`${id}.md`));
    commit(owner(id), 1, i, `add ${id.split("/").pop().replaceAll("-", " ")}`);
  });
  for (const [f, data] of final) if (!existsSync(join(dest, f)) || !readFileSync(join(dest, f)).equals(data)) write(f, data);
  commit("clement", 1, 99, "tidy vault");
  git({}, "config", "user.name", "Defluance demo");
  git({}, "config", "user.email", "demo@acme-pay.example");
  rmSync(src, { recursive: true, force: true });
  return ids.length;
}

// ---------- live activity through the REST API ----------

export const ADMIN_TOKEN = "dfl_demo_token_local";
export const PASSPHRASE = "demo-passphrase-2026";

const PORTAL = `---
type: functional-spec
status: draft
owner: claude-code
tags: [billing, customers]
acceptance_criteria:
  - A customer can download every invoice and credit note without contacting support
  - A customer can update the card used for future renewals
  - A customer can see open invoices and pay them from the portal
links:
  - "[[produit/invoice-lifecycle|depends_on]]"
  - "[[produit/payment-retries|related]]"
  - "[[produit/checkout|related]]"
---
# Customer portal

Proposed by an agent after reading the support backlog: 31% of billing tickets last quarter ask for an invoice copy or a card update, both things a customer could do alone.

## Scope

A signed-in page per customer contact listing invoices, credit notes and the saved payment method. Payment reuses the hosted checkout ([[produit/checkout]]); card updates feed [[produit/payment-retries]] so a failed renewal can heal itself.

## Open questions

Who counts as a customer user, and is the portal behind SSO for enterprise workspaces?
`;

export async function seedLive(base, log = console.log) {
  const call = async (token, method, path, body) => {
    const res = await fetch(`${base}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  };
  const must = async (label, token, method, path, body) => {
    const r = await call(token, method, path, body);
    if (!r.ok) throw new Error(`${label}: ${method} ${path} -> ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
    log(`  ok  ${label}`);
    return r.data;
  };
  const admin = ADMIN_TOKEN;
  const mkToken = async (name, scopes, spaces = []) => {
    const t = await must(`token ${name}`, admin, "POST", "/tokens", { name, scopes, spaces, expires_in_days: 90 });
    return t.token ?? t.value ?? t.secret;
  };
  const agents = {
    "claude-code": await mkToken("claude-code", ["read", "write"]),
    "cursor-agent": await mkToken("cursor-agent", ["read", "write"], ["produit", "tech"]),
    "release-bot": await mkToken("release-bot", ["read"]),
  };

  // Drafts: an agent proposes a new spec and an edit; another agent edits a note that then changes on main.
  const cc = agents["claude-code"], cur = agents["cursor-agent"];
  await must("draft: new spec produit/customer-portal", cc, "POST", "/notes", { id: "produit/customer-portal", content: PORTAL, message: "draft: customer portal spec" });
  const pr = await must("read produit/password-reset", cc, "GET", "/notes/produit%2Fpassword-reset");
  await must("draft: edit produit/password-reset", cc, "PUT", "/notes/produit%2Fpassword-reset", {
    content: `${pr.raw.trimEnd()}\n\n## Abuse protection\n\nA reset request for an unknown address answers exactly like a known one, so the form cannot be used to find out who has an account. At most five requests per address and per hour; beyond that we stay silent. The limit is enforced by [[tech/rate-limiting]].\n`,
    base_commit: pr.commit, message: "password reset: abuse protection section",
  });
  const rl = await must("read tech/rate-limiting", cur, "GET", "/notes/tech%2Frate-limiting");
  const line = "The public API allows one hundred requests per minute per token.";
  await must("draft: edit tech/rate-limiting", cur, "PUT", "/notes/tech%2Frate-limiting", {
    content: rl.raw.replace(line, "The public API allows three hundred requests per minute per token, and a burst of fifty requests per second."),
    base_commit: rl.commit, message: "rate limiting: raise the default limit",
  });
  // The same paragraph changes on main afterwards, so the draft no longer merges cleanly.
  const rl2 = await must("read tech/rate-limiting on main", admin, "GET", "/notes/tech%2Frate-limiting");
  await must("main: tighten the limit meanwhile", admin, "PUT", "/notes/tech%2Frate-limiting", {
    content: rl2.raw.replace(line, "The public API allows sixty requests per minute per token, counted over a sliding window."),
    base_commit: rl2.commit, message: "rate limiting: sliding window, sixty per minute",
  });

  // A few changes by a person, for the audit log.
  await must("status usage-based-billing -> approved", admin, "PATCH", "/notes/produit%2Fusage-based-billing/status", { status: "approved" });
  await must("status audit-export -> review", admin, "PATCH", "/notes/produit%2Faudit-export/status", { status: "review" });
  await must("status adr-0006 -> approved", admin, "PATCH", "/notes/tech%2Fadr-0006-psp-abstraction/status", { status: "approved" });
  await must("link payment-retries tracked_by #58", admin, "POST", "/notes/produit%2Fpayment-retries/links", { to: "gh:acme/app#58", type: "tracked_by" });
  await must("link credit-notes related notifications", admin, "POST", "/notes/produit%2Fcredit-notes/links", { to: "produit/notifications", type: "related" });

  // A private note, then lock the key so the UI shows the unlock flow.
  await must("key for the admin", admin, "POST", "/keys", { label: "Demo admin key", passphrase: PASSPHRASE });
  await must("private note ops/acquisition-due-diligence", admin, "POST", "/notes", {
    id: "ops/acquisition-due-diligence", private: true, message: "add acquisition due diligence",
    content: `---\ntype: note\nstatus: draft\nowner: clement\ntags: [confidential, corp-dev]\n---\n# Acquisition due diligence\n\nConfidential. Working notes on the possible acquisition of Ledgerly, a Berlin invoice-reconciliation startup.\n\n- Asking price: 14 million EUR, we think 9 is fair.\n- 31 employees, 4 of them hold the reconciliation engine knowledge.\n- Their PSP contract has a change-of-control clause, ask legal to read it before the next call.\n\nRelated: [[tech/ledger]], [[tech/psp-integration]].\n`,
  });
  await must("lock keys", admin, "POST", "/keys/lock");

  // Wait for the index so the UI is complete on first load.
  for (let i = 0; i < 120; i++) {
    const s = (await call(admin, "GET", "/index/status")).data;
    if (!s.pending && !s.jobs_pending) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return agents;
}
