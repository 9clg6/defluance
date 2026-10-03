import type { GhNode } from "@defluance/indexer";
import type { Ctx } from "../context.js";
import { HttpError } from "../errors.js";
import type { GithubClient } from "./client.js";
import { toIssue } from "./client.js";

/** Linked repositories read through GitHub's public API, without the App. JSON array of canonical `owner/name`. */
const PUBLIC_META = "gh_public_repos";
/** Unauthenticated calls: 60 per hour per IP. Stop this far from the limit so a few calls stay free. */
const MARGIN = 5;
/** First sync of a repository: the most recent 300 issues and 300 pull requests, so a huge repository does not eat the quota. */
const FIRST_PAGES = 3;
const MAX_PAGES = 10;
const FALLBACK_WAIT_MS = 15 * 60_000;

export interface PublicSyncState {
  repo: string;
  at: string;
  partial: boolean;
  rateLimitedUntil: string | null;
  /** Cursor: `since` of the next incremental sync. Null until one sync completed. */
  since: string | null;
}

export interface PublicSyncResult {
  synced: number;
  issues: number;
  pulls: number;
  partial: boolean;
  rateLimitedUntil: string | null;
}

export async function getPublicRepos(ctx: Ctx): Promise<string[]> {
  return JSON.parse((await ctx.store.getMeta(PUBLIC_META)) ?? "[]") as string[];
}

export async function setPublicRepos(ctx: Ctx, repos: string[]): Promise<void> {
  await ctx.store.setMeta(PUBLIC_META, JSON.stringify([...new Set(repos)].sort()));
}

const stateKey = (repo: string) => `gh_last_sync:${repo.toLowerCase()}`;

export async function getPublicState(ctx: Ctx, repo: string): Promise<PublicSyncState | null> {
  return JSON.parse((await ctx.store.getMeta(stateKey(repo))) ?? "null") as PublicSyncState | null;
}

/** Reads public repositories through `GET /repos/...` without credentials, and watches the unauthenticated rate limit. */
export class PublicGithub {
  /** Last rate limit GitHub told us about, shared by every repository: the limit is per IP. */
  private limit: { remaining: number; reset: number } | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly client: GithubClient,
  ) {}

  /** Null when the budget is spent and the window has not reset: no request is made. */
  private async get(path: string): Promise<Response | null> {
    const now = this.ctx.now().getTime();
    if (this.limit && this.limit.remaining <= MARGIN && this.limit.reset > now) return null;
    const res = await this.client.publicGet(path);
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    const retryAfter = res.headers.get("retry-after");
    if (res.status === 403 || res.status === 429) {
      const at = reset ? Number(reset) * 1000 : retryAfter ? now + Number(retryAfter) * 1000 : null;
      this.limit = { remaining: 0, reset: at ?? now + FALLBACK_WAIT_MS };
    } else if (remaining !== null && reset !== null) this.limit = { remaining: Number(remaining), reset: Number(reset) * 1000 };
    return res;
  }

  private until(): string | null {
    return this.limit && this.limit.remaining <= MARGIN && this.limit.reset > this.ctx.now().getTime() ? new Date(this.limit.reset).toISOString() : null;
  }

  /** Canonical `owner/name` of a public repository. 422 if missing or private, 503 if GitHub rate-limits us. */
  async validate(repo: string): Promise<string> {
    const res = await this.get(`/repos/${repo}`);
    if (!res || res.status === 403 || res.status === 429) {
      const until = this.until();
      throw new HttpError(503, `GitHub rate limit reached for unauthenticated requests${until ? `, try again after ${until}` : ""}`, until ? { rateLimitedUntil: until } : {});
    }
    if (res.status === 404) throw new HttpError(422, "repository not found or private");
    if (!res.ok) throw new HttpError(502, `GitHub answered ${res.status} for ${repo}`);
    const body = (await res.json()) as { full_name?: string; private?: boolean };
    if (body.private) throw new HttpError(422, "only public repositories can be linked without installing the App");
    return body.full_name ?? repo;
  }

  /**
   * Issues and pull requests changed since the last complete sync. Never throws on a rate limit: keeps what it fetched,
   * reports `partial` and the time the limit resets. Files of pull requests are not read (one call each): `files` stays empty.
   */
  async sync(repo: string): Promise<PublicSyncResult> {
    const prev = await getPublicState(this.ctx, repo);
    const startedAt = this.ctx.now().toISOString();
    const since = prev?.since ?? null;
    const pages = since ? MAX_PAGES : FIRST_PAGES;
    const counts = { issues: 0, pulls: 0 };
    let partial = false;

    const run = async (what: "issues" | "pulls"): Promise<void> => {
      for (let page = 1; page <= pages; page++) {
        const q = new URLSearchParams({ state: "all", sort: "updated", direction: "desc", per_page: "100", page: String(page), ...(what === "issues" && since ? { since } : {}) });
        const res = await this.get(`/repos/${repo}/${what}?${q}`);
        if (!res || res.status === 403 || res.status === 429) {
          partial = true;
          return;
        }
        if (!res.ok) throw new Error(`GitHub list ${what} of ${repo}: ${res.status}`);
        const rows = (await res.json()) as Record<string, any>[];
        for (const r of rows) {
          // The pulls endpoint has no `since`: it is sorted by update date, so the first old row ends the walk.
          if (what === "pulls" && since && String(r["updated_at"]) < since) return;
          if (what === "issues" && r["pull_request"]) continue; // pull requests come from /pulls, which has merged_at
          const i = toIssue(r, what === "pulls");
          const node: GhNode = { key: `${repo}#${i.number}`, kind: i.isPull ? "pull-request" : "issue", state: i.merged ? "merged" : i.state, title: i.title, labels: i.labels, author: i.author, files: [], merged_at: i.merged_at, url: i.url, updated_at: i.updated_at };
          await this.ctx.store.upsertGhNode(node);
          counts[what]++;
        }
        if (rows.length < 100) return;
      }
      // The first sync stops at its cap on purpose; an incremental one that still has pages left is partial.
      if (since) partial = true;
    };
    await run("issues");
    if (!partial) await run("pulls");

    const synced = counts.issues + counts.pulls;
    if (synced) await this.ctx.store.bump();
    const rateLimitedUntil = partial ? this.until() : null;
    // A partial walk may have missed older changes: keep the cursor so the next one covers them again.
    const state: PublicSyncState = { repo, at: startedAt, partial, rateLimitedUntil, since: partial ? since : startedAt };
    await this.ctx.store.setMeta(stateKey(repo), JSON.stringify(state));
    return { synced, ...counts, partial, rateLimitedUntil };
  }
}
