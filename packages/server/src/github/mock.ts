import { readFileSync } from "node:fs";
import type { GhNode, Handler } from "@defluance/indexer";
import type { Ctx } from "../context.js";
import { HttpError } from "../errors.js";
import type { GithubPort } from "../ports.js";

/** Six plausible objects for `acme/app`, used when `DFL_GITHUB_MOCK_FILE` is not set. */
export const DEFAULT_MOCK_NODES: GhNode[] = [
  { key: "acme/app#12", kind: "issue", state: "open", title: "Users cannot reset their password from the mobile app", labels: ["bug", "auth"], author: "nadia", files: [], merged_at: null, url: "https://github.com/acme/app/issues/12", updated_at: "2026-09-28T09:12:00Z" },
  { key: "acme/app#14", kind: "issue", state: "closed", title: "Add CSV export to the reporting table", labels: ["feature"], author: "karim", files: [], merged_at: null, url: "https://github.com/acme/app/issues/14", updated_at: "2026-09-20T15:40:00Z" },
  { key: "acme/app#17", kind: "issue", state: "open", title: "Session cookies should expire after 15 minutes of inactivity", labels: ["security", "auth"], author: "ana", files: [], merged_at: null, url: "https://github.com/acme/app/issues/17", updated_at: "2026-09-30T11:05:00Z" },
  { key: "acme/app#21", kind: "pull-request", state: "open", title: "Rotate session tokens on privilege change", labels: ["security"], author: "karim", files: ["src/auth/session.ts", "src/auth/session.test.ts"], merged_at: null, url: "https://github.com/acme/app/pull/21", updated_at: "2026-10-01T08:30:00Z" },
  { key: "acme/app#22", kind: "pull-request", state: "merged", title: "Send the reset link by email, valid for one hour", labels: ["feature", "auth"], author: "nadia", files: ["src/auth/reset.ts", "src/mail/templates/reset.html"], merged_at: "2026-09-26T16:20:00Z", url: "https://github.com/acme/app/pull/22", updated_at: "2026-09-26T16:20:00Z" },
  { key: "acme/app#23", kind: "pull-request", state: "closed", title: "Draft: replace the webhook retry loop", labels: ["tech-debt"], author: "ana", files: ["src/webhooks/retry.ts"], merged_at: null, url: "https://github.com/acme/app/pull/23", updated_at: "2026-09-18T10:00:00Z" },
];

const KINDS = ["issue", "pull-request"];
const STATES = ["open", "closed", "merged"];

/** Read `DFL_GITHUB_MOCK_FILE`: a JSON array of GitHub objects. Anything malformed is an error at startup, not a surprise later. */
export function loadMockNodes(file: string | undefined): GhNode[] {
  if (!file) return structuredClone(DEFAULT_MOCK_NODES);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`DFL_GITHUB_MOCK_FILE ${file}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  if (!Array.isArray(data)) throw new Error(`DFL_GITHUB_MOCK_FILE ${file}: expected a JSON array`);
  return data.map((raw: Record<string, unknown>, i) => {
    const bad = (why: string) => new Error(`DFL_GITHUB_MOCK_FILE ${file}: item ${i}: ${why}`);
    if (typeof raw?.["key"] !== "string" || !/^[\w.-]+\/[\w.-]+#\d+$/.test(raw["key"])) throw bad('"key" must look like "owner/repo#12"');
    if (!KINDS.includes(raw["kind"] as string)) throw bad(`"kind" must be ${KINDS.join(" or ")}`);
    if (!STATES.includes(raw["state"] as string)) throw bad(`"state" must be ${STATES.join(", ")}`);
    if (typeof raw["title"] !== "string") throw bad('"title" must be a string');
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    return {
      key: raw["key"], kind: raw["kind"] as GhNode["kind"], state: raw["state"] as GhNode["state"], title: raw["title"],
      labels: strings(raw["labels"]), author: str(raw["author"]), files: strings(raw["files"]), merged_at: str(raw["merged_at"]),
      url: str(raw["url"]) ?? `https://github.com/${raw["key"].replace("#", raw["kind"] === "issue" ? "/issues/" : "/pull/")}`,
      updated_at: str(raw["updated_at"]) ?? "2026-10-01T00:00:00Z",
    };
  });
}

/**
 * A GitHub connector that never leaves the process, for demos (`DFL_GITHUB=mock`). It knows a fixed set of issues and pull
 * requests, "creates" new ones with the next number, and `resync` writes them into the index so they show in the graph.
 */
export class MockGithub implements GithubPort {
  readonly mock = true;
  /** Comments "posted", for tests. */
  readonly comments: { repo: string; number: number; body: string }[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly nodes: GhNode[] = loadMockNodes(undefined),
  ) {}

  handlers(): Record<string, Handler> {
    return { "github.resync": (p) => this.resync((p as { repo?: string } | null)?.repo).then(() => undefined) };
  }

  async repos(): Promise<string[]> {
    const config = await this.ctx.getConfig();
    return [...new Set([...this.nodes.map((n) => n.key.split("#")[0] as string), ...config.repos, ...config.spaces.flatMap((s) => s.repos)])].sort();
  }

  /** A repository is "public" for the demo when it has seeded objects or is already known. */
  async validatePublic(repo: string): Promise<string> {
    const known = (await this.repos()).find((r) => r.toLowerCase() === repo.toLowerCase());
    if (!known) throw new HttpError(422, "repository not found or private");
    return known;
  }

  private nextNumber(repo: string): number {
    return Math.max(0, ...this.nodes.filter((n) => n.key.startsWith(`${repo}#`)).map((n) => Number(n.key.split("#")[1]))) + 1;
  }

  private async add(repo: string, kind: GhNode["kind"], input: { title: string; labels?: string[] | undefined; files?: string[] }) {
    const number = this.nextNumber(repo);
    const url = `https://github.com/${repo}/${kind === "issue" ? "issues" : "pull"}/${number}`;
    const node: GhNode = { key: `${repo}#${number}`, kind, state: "open", title: input.title, labels: input.labels ?? [], author: "demo", files: input.files ?? [], merged_at: null, url, updated_at: this.ctx.now().toISOString() };
    this.nodes.push(node);
    await this.ctx.store.upsertGhNode(node);
    return { key: node.key, number, url };
  }

  createIssue(repo: string, input: { title: string; body: string; labels?: string[] }) {
    return this.add(repo, "issue", input);
  }

  async createPullRequest(repo: string, input: { title: string; body: string; head: string; base: string }) {
    const { number, url } = await this.add(repo, "pull-request", { title: input.title });
    return { number, url };
  }

  async comment(repo: string, number: number, body: string): Promise<void> {
    this.comments.push({ repo, number, body });
  }

  async handleWebhook() {
    return { status: 202, message: "mock: webhooks are ignored" };
  }

  async resync(repo?: string): Promise<{ issues: number; pulls: number }> {
    const nodes = repo ? this.nodes.filter((n) => n.key.toLowerCase().startsWith(`${repo.toLowerCase()}#`)) : this.nodes;
    for (const n of nodes) await this.ctx.store.upsertGhNode(n);
    await this.ctx.store.bump();
    return { issues: nodes.filter((n) => n.kind === "issue").length, pulls: nodes.filter((n) => n.kind === "pull-request").length };
  }
}
