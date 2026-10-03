import { createHmac, timingSafeEqual } from "node:crypto";
import { head, pull as gitPull } from "@defluance/vault-core";
import type { GhNode, Handler } from "@defluance/indexer";
import type { Actor } from "../auth.js";
import { indexNow, type Ctx } from "../context.js";
import type { GithubPort } from "../ports.js";
import * as svc from "../services/index.js";
import { PERMS } from "../system.js";
import { GithubClient, toIssue, type GhIssue } from "./client.js";

/** Verify `X-Hub-Signature-256`: HMAC SHA-256 of the raw body, constant-time comparison. */
export function verifySignature(secret: string, body: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const IMPACT_MARKER = "<!-- defluance-impact -->";

interface WebhookJob {
  event: string;
  delivery: string | null;
  payload: Record<string, any>;
}

const botActor: Actor = { kind: "user", id: "bot", name: "defluance-bot", agent: false, grants: [{ space: "*", perms: new Set(PERMS) }] };

function toNode(repo: string, i: GhIssue, files: string[]): GhNode {
  return {
    key: `${repo}#${i.number}`,
    kind: i.isPull ? "pull-request" : "issue",
    state: i.merged ? "merged" : i.state,
    title: i.title,
    labels: i.labels,
    author: i.author,
    files,
    merged_at: i.merged_at,
    url: i.url,
    updated_at: i.updated_at,
  };
}

export class GithubService implements GithubPort {
  constructor(
    private readonly ctx: Ctx,
    private readonly client: GithubClient,
    private readonly webhookSecret: string,
  ) {}

  async repos(): Promise<string[]> {
    const cached = await this.ctx.store.getMeta("gh_repos");
    const at = Number((await this.ctx.store.getMeta("gh_repos_at")) ?? 0);
    if (cached && this.ctx.now().getTime() - at < 5 * 60_000) return JSON.parse(cached) as string[];
    const repos = await this.client.installedRepos();
    await this.ctx.store.setMeta("gh_repos", JSON.stringify(repos));
    await this.ctx.store.setMeta("gh_repos_at", String(this.ctx.now().getTime()));
    return repos;
  }

  async createIssue(repo: string, input: { title: string; body: string; labels?: string[] }) {
    const r = await this.client.createIssue(repo, input);
    return { key: `${repo}#${r.number}`, number: r.number, url: r.url };
  }

  async comment(repo: string, number: number, body: string): Promise<void> {
    await this.client.upsertComment(repo, number, IMPACT_MARKER, body);
  }

  /** Check the signature, queue the work, answer fast: GitHub gives up after 10 seconds. */
  async handleWebhook(i: { event: string; delivery: string | null; signature: string | null; body: string }) {
    if (!verifySignature(this.webhookSecret, i.body, i.signature)) return { status: 401, message: "invalid signature" };
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(i.body) as Record<string, any>;
    } catch {
      return { status: 400, message: "invalid JSON" };
    }
    if (i.event === "ping") return { status: 200, message: "pong" };
    if (!["issues", "pull_request", "push", "installation", "installation_repositories"].includes(i.event)) return { status: 202, message: "ignored" };
    await this.ctx.jobs.enqueue("github.webhook", { event: i.event, delivery: i.delivery, payload } satisfies WebhookJob);
    return { status: 202, message: "queued" };
  }

  handlers(): Record<string, Handler> {
    return {
      "github.webhook": (p) => this.process(p as WebhookJob),
      "github.resync": () => this.resync().then(() => undefined),
    };
  }

  private async process(job: WebhookJob): Promise<void> {
    const repo = job.payload["repository"]?.full_name as string | undefined;
    switch (job.event) {
      case "issues": {
        if (!repo || job.payload["issue"]?.pull_request) return;
        const issue = toIssue(job.payload["issue"]);
        await this.ctx.store.upsertGhNode(toNode(repo, issue, []));
        await this.ctx.store.bump();
        return;
      }
      case "pull_request": {
        if (!repo) return;
        const pr = toIssue({ ...job.payload["pull_request"], merged: job.payload["pull_request"]?.merged }, true);
        const files = await this.client.pullFiles(repo, pr.number).catch(() => (this.ctx.store.ghNode(`${repo}#${pr.number}`).then((n) => n?.files ?? [])));
        const node = toNode(repo, pr, files);
        await this.ctx.store.upsertGhNode(node);
        await this.ctx.store.bump();
        const config = await this.ctx.getConfig();
        if (node.state === "merged" && config.deriveStatus) await this.deriveStatus(node.key);
        if (node.state === "open" && config.prComments) await this.commentImpact(repo, pr.number, node.key);
        return;
      }
      case "push": {
        const config = await this.ctx.getConfig();
        if (!repo || repo !== config.vaultRepo) return;
        // Only the branch the vault is on: other branches hold drafts.
        const branch = String(job.payload["ref"] ?? "").replace("refs/heads/", "");
        const current = await head(this.ctx.root).catch(() => null);
        if (!current) return;
        await gitPull(this.ctx.root).catch((e: unknown) => {
          throw new Error(`could not fast-forward the vault after a push to ${branch}: ${e instanceof Error ? e.message : String(e)}`);
        });
        await indexNow(this.ctx);
        return;
      }
      case "installation":
      case "installation_repositories":
        await this.ctx.store.setMeta("gh_repos_at", "0");
        return;
    }
  }

  /** Merged pull request: notes it tracks, still `approved`, become `implemented`. */
  async deriveStatus(key: string): Promise<string[]> {
    const changed: string[] = [];
    for (const { note, link_type } of await this.ctx.store.notesLinkingToGh(key)) {
      if (link_type !== "tracked_by" || note.status !== "approved") continue;
      await svc.setStatus(this.ctx, botActor, note.id, "implemented", { mode: "direct", message: `status ${note.id}: implemented (${key} merged)` });
      await svc.audit(this.ctx, botActor, "status.derive", note.id, { from: "approved", to: "implemented", pr: key });
      changed.push(note.id);
    }
    return changed;
  }

  private async commentImpact(repo: string, n: number, key: string): Promise<void> {
    const impact = await svc.impactOfPullRequest(this.ctx, botActor, key);
    if (!impact.seeds.length) return;
    const link = (id: string) => `[${id}](${this.ctx.publicUrl}/n/${id.split("/").map(encodeURIComponent).join("/")})`;
    const lines = [
      "### Specs touched by this pull request",
      ...impact.seeds.map((s) => `- ${link(s.id)} (${s.reason})`),
      ...(impact.impacted.length ? ["", "Also affected:", ...impact.impacted.map((s) => `- ${link(s.id)} (via ${s.via})`)] : []),
    ];
    await this.client.upsertComment(repo, n, IMPACT_MARKER, lines.join("\n"));
  }

  /** Re-read issues and pull requests changed since the last sync, for every repository the vault uses. */
  async resync(): Promise<{ issues: number; pulls: number }> {
    const config = await this.ctx.getConfig();
    const repos = [...new Set([...config.repos, ...config.spaces.flatMap((s) => s.repos)])];
    const since = (await this.ctx.store.getMeta("gh_last_sync")) || undefined;
    const startedAt = this.ctx.now().toISOString();
    let issues = 0;
    let pulls = 0;
    for (const repo of repos) {
      for (const i of await this.client.listIssues(repo, since)) {
        const files = i.isPull ? await this.client.pullFiles(repo, i.number).catch(() => []) : [];
        const node = toNode(repo, i.isPull ? await this.client.getPull(repo, i.number).catch(() => i) : i, files);
        await this.ctx.store.upsertGhNode(node);
        if (i.isPull) pulls++;
        else issues++;
      }
    }
    await this.ctx.store.setMeta("gh_last_sync", startedAt);
    await this.ctx.store.bump();
    return { issues, pulls };
  }
}

/** Build the connector from `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`. Null if not configured. */
export function githubFromEnv(ctx: Ctx, env: Record<string, string | undefined> = process.env): GithubService | null {
  const appId = env["GITHUB_APP_ID"];
  const privateKey = env["GITHUB_APP_PRIVATE_KEY"];
  const secret = env["GITHUB_WEBHOOK_SECRET"];
  if (!appId || !privateKey || !secret) return null;
  const client = new GithubClient({ appId, privateKey, ...(env["GITHUB_API_URL"] ? { apiUrl: env["GITHUB_API_URL"] } : {}), fetch: ctx.fetch });
  return new GithubService(ctx, client, secret);
}
