import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hashEmbedder } from "@defluance/shared";
import type { Llm } from "@defluance/ai";
import { createApp } from "./app.js";
import { createContext, indexNow, jobHandlers, type Ctx } from "./context.js";
import type { GithubPort } from "./ports.js";
import type { Perm } from "./system.js";

export const note = (type: string, status: string, body: string, extra = "") =>
  `---\ntype: ${type}\nstatus: ${status}\nowner: ana\n${extra}---\n${body}\n`;

export const FILES: Record<string, string> = {
  ".defluance/config.yaml": "spaces:\n  - { name: produit, path: produit, repos: [acme/app] }\n  - { name: tech, path: tech }\n  - { name: secret, path: secret }\nrepos: [acme/default]\n",
  "produit/auth-login.md": note("functional-spec", "approved", "# Login\n\nUsers sign in with email and password. See [[tech/sessions|depends_on]] and [[produit/password-reset]].", "acceptance_criteria: []\ntags: [auth]\n"),
  "produit/password-reset.md": note("functional-spec", "draft", "# Password reset\n\nA reset link is valid for one hour.", "acceptance_criteria: []\n"),
  "tech/sessions.md": note("technical-spec", "approved", "# Sessions\n\nSigned JWT cookies expire after fifteen minutes.", "tags: [auth]\n"),
  "secret/plans.md": note("note", "draft", "# Plans\n\nAcquisition target codename Falcon."),
  "readme.md": note("note", "draft", "# Readme\n\nWelcome. Start at [[produit/auth-login]]."),
};

export interface TestServer {
  ctx: Ctx;
  root: string;
  admin: string;
  token(scopes: Perm[], spaces?: string[], name?: string): Promise<string>;
  call(method: string, path: string, o?: { token?: string | null; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: any; res: Response }>;
  request: (input: string, init?: RequestInit) => Response | Promise<Response>;
  git(...args: string[]): string;
  flush(): Promise<void>;
  cleanup(): Promise<void>;
}

export async function makeServer(o: { files?: Record<string, string>; github?: GithubPort | null | ((ctx: Ctx) => GithubPort); llm?: Llm | null; env?: Record<string, string>; fetch?: typeof fetch; uiDir?: string } = {}): Promise<TestServer> {
  const root = await mkdtemp(join(tmpdir(), "dfl-srv-"));
  for (const [p, c] of Object.entries(o.files ?? FILES)) {
    await mkdir(dirname(join(root, p)), { recursive: true });
    await writeFile(join(root, p), c);
  }
  const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");

  const ctx = await createContext({
    root,
    env: { DFL_SESSION_SECRET: "test-secret-test-secret", DFL_PUBLIC_URL: "http://localhost:4000", ...(o.env ?? {}) },
    embedder: hashEmbedder(),
    llm: o.llm ?? null,
    github: typeof o.github === "function" ? null : (o.github ?? null),
    log: false,
    ...(o.fetch ? { fetch: o.fetch } : {}),
    ...(o.uiDir ? { uiDir: o.uiDir } : {}),
  });
  if (typeof o.github === "function") ctx.github = o.github(ctx);
  await indexNow(ctx);
  const { app } = createApp(ctx);
  const admin = (await ctx.sys.createToken({ name: "admin", scopes: ["read", "write", "issues", "admin"], spaces: [], createdBy: "test" })).token;

  const call: TestServer["call"] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    const t = opts.token === undefined ? admin : opts.token;
    if (t) headers["authorization"] = `Bearer ${t}`;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: res.status, body, res };
  };

  return {
    ctx,
    root,
    admin,
    token: async (scopes, spaces = [], name = `t-${Math.random().toString(36).slice(2, 7)}`) => (await ctx.sys.createToken({ name, scopes, spaces, createdBy: "test" })).token,
    call,
    request: (input, init) => app.request(input, init),
    git,
    flush: async () => void (await ctx.jobs.runDue(jobHandlers(ctx))),
    cleanup: async () => {
      ctx.jobs.stop();
      await ctx.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
