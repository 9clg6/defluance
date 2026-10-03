import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockLlm } from "@defluance/ai";
import { afterEach, describe, expect, it } from "vitest";
import { startServer } from "../server.js";
import { FILES, makeServer, type TestServer } from "../test-env.js";
import { githubFromEnv } from "./service.js";
import { DEFAULT_MOCK_NODES, MockGithub, loadMockNodes } from "./mock.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});
const server = async (o: Parameters<typeof makeServer>[0] = {}) => {
  const s = await makeServer(o);
  cleanups.push(() => s.cleanup());
  return s;
};
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), "dfl-mock-"));
  cleanups.push(() => rm(d, { recursive: true, force: true }));
  return d;
};

describe("mock GitHub", () => {
  it("is only built when DFL_GITHUB=mock, and wins over real credentials", async () => {
    const s: TestServer = await server();
    expect(githubFromEnv(s.ctx, {})).toBeNull();
    expect(githubFromEnv(s.ctx, { DFL_GITHUB: "yes" })).toBeNull();
    expect(githubFromEnv(s.ctx, { GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "x", GITHUB_WEBHOOK_SECRET: "y" })?.mock).toBeUndefined();
    const gh = githubFromEnv(s.ctx, { DFL_GITHUB: "mock", GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "x", GITHUB_WEBHOOK_SECRET: "y" });
    expect(gh).toBeInstanceOf(MockGithub);
    expect(gh?.mock).toBe(true);
    expect(s.logs.join("\n")).toContain("MOCK MODE: GitHub");
  });

  it("has six default nodes for acme/app and loads them into the index on resync", async () => {
    const s = await server({ files: { ...FILES, "produit/auth-login.md": FILES["produit/auth-login.md"] as string } });
    const gh = new MockGithub(s.ctx);
    s.ctx.github = gh;
    expect(DEFAULT_MOCK_NODES).toHaveLength(6);
    expect(await gh.repos()).toEqual(["acme/app", "acme/default"]);
    expect(await gh.resync()).toEqual({ issues: 3, pulls: 3 });
    const node = await s.call("GET", "/api/v1/github/nodes/acme/app/22");
    expect(node.body).toMatchObject({ kind: "pull-request", state: "merged", files: expect.arrayContaining(["src/auth/reset.ts"]) });
    expect((await s.call("POST", "/api/v1/github/resync")).body).toEqual({ issues: 3, pulls: 3 });
    expect((await s.call("GET", "/api/v1/github/status")).body).toMatchObject({ configured: true });
  });

  it("creates issues and pull requests with the next number, and a note links to them in the graph", async () => {
    const s = await server();
    const gh = new MockGithub(s.ctx);
    s.ctx.github = gh;
    await gh.resync();
    const r = await s.call("POST", `/api/v1/notes/${encodeURIComponent("produit/auth-login")}/issues`, { body: { repo: "acme/app", title: "Lockout" } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ key: "acme/app#24", number: 24, url: "https://github.com/acme/app/issues/24" });
    const links = (await s.call("GET", `/api/v1/notes/${encodeURIComponent("produit/auth-login")}/links`)).body.outgoing.tracked_by;
    expect(links[0]).toMatchObject({ kind: "github", github: { key: "acme/app#24", state: "open", title: "Lockout" } });
    const pr = await gh.createPullRequest("acme/app", { title: "Lockout", body: "", head: "feat", base: "main" });
    expect(pr).toEqual({ number: 25, url: "https://github.com/acme/app/pull/25" });
    await gh.comment("acme/app", 25, "impact");
    expect(gh.comments).toEqual([{ repo: "acme/app", number: 25, body: "impact" }]);
    expect((await gh.handleWebhook()).status).toBe(202);
  });

  it("reads its objects from DFL_GITHUB_MOCK_FILE, and rejects a malformed file", async () => {
    const dir = await tmp();
    const file = join(dir, "gh.json");
    await writeFile(file, JSON.stringify([{ key: "org/repo#3", kind: "pull-request", state: "open", title: "Mine", labels: ["x"], author: "me", files: ["a.ts"], merged_at: null, url: "https://example.test/3", updated_at: "2026-01-01T00:00:00Z" }, { key: "org/repo#9", kind: "issue", state: "closed", title: "Old" }]));
    const nodes = loadMockNodes(file);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ key: "org/repo#3", files: ["a.ts"], url: "https://example.test/3" });
    expect(nodes[1]).toMatchObject({ labels: [], files: [], author: null, url: "https://github.com/org/repo/issues/9" });
    const s = await server();
    const gh = new MockGithub(s.ctx, nodes);
    expect(await gh.repos()).toEqual(["acme/app", "acme/default", "org/repo"]);
    expect((await gh.createIssue("org/repo", { title: "t", body: "" })).number).toBe(10);
    await writeFile(file, JSON.stringify([{ key: "bad", kind: "issue", state: "open", title: "x" }]));
    expect(() => loadMockNodes(file)).toThrow(/item 0: "key" must look like/);
    await writeFile(file, "{}");
    expect(() => loadMockNodes(file)).toThrow(/expected a JSON array/);
    expect(() => loadMockNodes(join(dir, "missing.json"))).toThrow(/DFL_GITHUB_MOCK_FILE/);
  });
});

describe("mock mode is visible", () => {
  it("/health says mock for the model and GitHub, and real setups say what they are", async () => {
    const real = await server();
    expect((await real.call("GET", "/health", { token: null })).body.checks).toMatchObject({ llm: "none (extractive answers)", github: "none" });
    const s = await server({ llm: createMockLlm() });
    s.ctx.github = new MockGithub(s.ctx);
    const h = await s.call("GET", "/health", { token: null });
    expect(h.body.checks).toMatchObject({ llm: "mock (demo model, canned answers)", github: "mock" });
    expect(h.body.status).toBe("ok");
  });

  it("the interface sees the model as present, named mock:demo, without tool calling", async () => {
    const s = await server({ llm: createMockLlm() });
    const caps = (await s.call("GET", "/api/v1/index/status")).body.capabilities;
    expect(caps).toMatchObject({ llm: "mock:demo", deep: false });
    expect(Object.keys(caps).sort()).toEqual(["collab", "deep", "embedder", "llm", "semantic"]);
  });

  it("startServer logs MOCK MODE for each mock, and loads the demo issues without a sync", async () => {
    const root = await tmp();
    await writeFile(join(root, "a.md"), "---\ntype: note\nstatus: draft\nowner: x\n---\n# A\n");
    const logs: string[] = [];
    const running = await startServer({ root, port: 0, env: { DFL_SESSION_SECRET: "test-secret-test-secret", DFL_LLM: "mock", DFL_GITHUB: "mock" }, log: (e) => void logs.push(String(e["msg"])) });
    try {
      expect(logs.filter((l) => l.startsWith("MOCK MODE")).sort()).toEqual([expect.stringContaining("GitHub is an in-process fake"), expect.stringContaining("language model is a canned demo")]);
      expect(await running.ctx.store.ghNode("acme/app#12")).toMatchObject({ kind: "issue" });
      expect(running.ctx.llm?.id).toBe("mock:demo");
    } finally {
      await running.close();
    }
  });

  it("nothing is mocked by default", async () => {
    const root = await tmp();
    await writeFile(join(root, "a.md"), "---\ntype: note\nstatus: draft\nowner: x\n---\n# A\n");
    const logs: string[] = [];
    const running = await startServer({ root, port: 0, env: { DFL_SESSION_SECRET: "test-secret-test-secret" }, log: (e) => void logs.push(String(e["msg"])) });
    try {
      expect(logs.some((l) => l.startsWith("MOCK MODE"))).toBe(false);
      expect(running.ctx.llm).toBeNull();
      expect(running.ctx.github).toBeNull();
    } finally {
      await running.close();
    }
  });
});
