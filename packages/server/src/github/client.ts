import { createSign } from "node:crypto";

export interface GithubAppConfig {
  appId: string;
  /** PEM. `\n` escapes are accepted so it fits in an environment variable. */
  privateKey: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface GhIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  labels: string[];
  author: string | null;
  url: string;
  updated_at: string;
  isPull: boolean;
  merged: boolean;
  merged_at: string | null;
}

const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");

/** Minimal GitHub App client on `fetch` and `node:crypto`. No Octokit. */
export class GithubClient {
  private readonly api: string;
  private readonly f: typeof fetch;
  private readonly now: () => number;
  private readonly key: string;
  private tokens = new Map<number, { token: string; expires: number }>();
  private installs = new Map<string, number>();

  constructor(private readonly cfg: GithubAppConfig) {
    this.api = (cfg.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
    this.f = cfg.fetch ?? fetch;
    this.now = cfg.now ?? Date.now;
    this.key = cfg.privateKey.replace(/\\n/g, "\n");
  }

  /** Short-lived JWT proving we are the App. */
  appJwt(): string {
    const iat = Math.floor(this.now() / 1000) - 60;
    const body = `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64(JSON.stringify({ iat, exp: iat + 600, iss: this.cfg.appId }))}`;
    return `${body}.${createSign("RSA-SHA256").update(body).sign(this.key).toString("base64url")}`;
  }

  /** What the App is allowed to do on repositories (`issues: "write"`, `pull_requests: "read"`...), as set on GitHub. */
  async permissions(): Promise<Record<string, string>> {
    return (await this.json<{ permissions?: Record<string, string> }>(await this.raw("GET", "/app", this.appJwt()), "app")).permissions ?? {};
  }

  private async raw(method: string, path: string, auth: string, body?: unknown): Promise<Response> {
    return this.f(`${this.api}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${auth}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "defluance",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  /** Unauthenticated GET, for public repositories: no App, no installation, nothing of the user's. */
  publicGet(path: string): Promise<Response> {
    return this.f(`${this.api}${path}`, { headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "defluance" } });
  }

  private async json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) throw new Error(`GitHub ${what}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  async installationToken(id: number): Promise<string> {
    const hit = this.tokens.get(id);
    if (hit && hit.expires - 60_000 > this.now()) return hit.token;
    const r = await this.json<{ token: string; expires_at: string }>(await this.raw("POST", `/app/installations/${id}/access_tokens`, this.appJwt(), {}), "installation token");
    this.tokens.set(id, { token: r.token, expires: new Date(r.expires_at).getTime() });
    return r.token;
  }

  /** Token for the installation that covers `owner/repo`. */
  private async tokenFor(repo: string): Promise<string> {
    let id = this.installs.get(repo);
    if (id === undefined) {
      id = (await this.json<{ id: number }>(await this.raw("GET", `/repos/${repo}/installation`, this.appJwt()), `installation of ${repo}`)).id;
      this.installs.set(repo, id);
    }
    return this.installationToken(id);
  }

  async installedRepos(): Promise<string[]> {
    const installs = await this.json<{ id: number }[]>(await this.raw("GET", "/app/installations?per_page=100", this.appJwt()), "installations");
    const repos: string[] = [];
    for (const i of installs) {
      const token = await this.installationToken(i.id);
      const r = await this.json<{ repositories: { full_name: string }[] }>(await this.raw("GET", "/installation/repositories?per_page=100", token), "installation repositories");
      for (const x of r.repositories) {
        repos.push(x.full_name);
        this.installs.set(x.full_name, i.id);
      }
    }
    return repos.sort();
  }

  async createIssue(repo: string, input: { title: string; body: string; labels?: string[] }): Promise<{ number: number; url: string }> {
    const r = await this.json<{ number: number; html_url: string }>(await this.raw("POST", `/repos/${repo}/issues`, await this.tokenFor(repo), input), `create issue in ${repo}`);
    return { number: r.number, url: r.html_url };
  }

  async createPullRequest(repo: string, input: { title: string; body: string; head: string; base: string }): Promise<{ number: number; url: string }> {
    const r = await this.json<{ number: number; html_url: string }>(await this.raw("POST", `/repos/${repo}/pulls`, await this.tokenFor(repo), input), `open a pull request in ${repo}`);
    return { number: r.number, url: r.html_url };
  }

  /** Issues and pull requests (GitHub lists both) updated since a date. */
  async listIssues(repo: string, since?: string): Promise<GhIssue[]> {
    const token = await this.tokenFor(repo);
    const out: GhIssue[] = [];
    for (let page = 1; page <= 10; page++) {
      const q = new URLSearchParams({ state: "all", per_page: "100", page: String(page), sort: "updated", direction: "desc", ...(since ? { since } : {}) });
      const rows = await this.json<Record<string, any>[]>(await this.raw("GET", `/repos/${repo}/issues?${q}`, token), `list issues of ${repo}`);
      for (const r of rows) out.push(toIssue(r));
      if (rows.length < 100) break;
    }
    return out;
  }

  async getPull(repo: string, n: number): Promise<GhIssue> {
    return toIssue(await this.json<Record<string, any>>(await this.raw("GET", `/repos/${repo}/pulls/${n}`, await this.tokenFor(repo)), `pull ${repo}#${n}`), true);
  }

  /** Paths touched by a pull request (first 300). */
  async pullFiles(repo: string, n: number): Promise<string[]> {
    const token = await this.tokenFor(repo);
    const out: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const rows = await this.json<{ filename: string }[]>(await this.raw("GET", `/repos/${repo}/pulls/${n}/files?per_page=100&page=${page}`, token), `files of ${repo}#${n}`);
      out.push(...rows.map((r) => r.filename));
      if (rows.length < 100) break;
    }
    return out;
  }

  /** Create or update the comment carrying `marker`. */
  async upsertComment(repo: string, n: number, marker: string, body: string): Promise<void> {
    const token = await this.tokenFor(repo);
    const existing = await this.json<{ id: number; body: string }[]>(await this.raw("GET", `/repos/${repo}/issues/${n}/comments?per_page=100`, token), "list comments");
    const mine = existing.find((c) => c.body.includes(marker));
    const text = `${marker}\n${body}`;
    if (mine) await this.json(await this.raw("PATCH", `/repos/${repo}/issues/comments/${mine.id}`, token, { body: text }), "update comment");
    else await this.json(await this.raw("POST", `/repos/${repo}/issues/${n}/comments`, token, { body: text }), "create comment");
  }
}

export function toIssue(r: Record<string, any>, forcePull = false): GhIssue {
  const isPull = forcePull || !!r["pull_request"];
  return {
    number: r["number"],
    title: r["title"],
    state: r["state"] === "closed" ? "closed" : "open",
    labels: (r["labels"] ?? []).map((l: { name?: string } | string) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
    author: r["user"]?.login ?? null,
    url: r["html_url"],
    updated_at: r["updated_at"],
    isPull,
    merged: !!(r["merged"] ?? r["pull_request"]?.merged_at ?? r["merged_at"]),
    merged_at: r["merged_at"] ?? r["pull_request"]?.merged_at ?? null,
  };
}
