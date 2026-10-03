import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GhNode } from "@defluance/indexer";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { FILES, makeServer, type TestServer } from "../test-env.js";
import { DEFAULT_MOCK_NODES, MockGithub } from "./mock.js";

const node = (key: string, over: Partial<GhNode> = {}): GhNode => ({
  key, kind: "issue", state: "open", title: "Thing", labels: [], author: "ana", files: [], merged_at: null, url: null, updated_at: "2026-09-15T00:00:00Z", ...over,
});
const CONFIG = `# vault settings
spaces:
  - { name: produit, path: produit, repos: [acme/app] }   # product
  - { name: tech, path: tech }
  - { name: secret, path: secret, repos: [acme/secret] }
repos: [acme/default]
# keep me
agent_write_mode: branch
`;
const NODES = [...DEFAULT_MOCK_NODES, node("acme/secret#1", { title: "Falcon plan" }), node("acme/web#1", { title: "Landing page" }), node("acme/default#5", { title: "Default repo issue" })];

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});
const server = async (o: Parameters<typeof makeServer>[0] = {}) => {
  const s = await makeServer({ files: { ...FILES, ".defluance/config.yaml": CONFIG }, github: (ctx) => new MockGithub(ctx, structuredClone(NODES)), ...o });
  cleanups.push(() => s.cleanup());
  if (s.ctx.github) await s.ctx.github.resync();
  return s;
};
const keys = (r: { body: { items: GhNode[] } }) => r.body.items.map((n) => n.key);

describe("GET /api/v1/github/items", () => {
  it("lists newest first, default limit 20, and filters", async () => {
    const s = await server();
    const all = await s.call("GET", "/api/v1/github/items");
    expect(all.status).toBe(200);
    expect(keys(all)[0]).toBe("acme/app#21");
    expect(keys(all)).toHaveLength(8);
    expect(keys(await s.call("GET", "/api/v1/github/items?kind=pull-request&repo=ACME/app"))).toEqual(["acme/app#21", "acme/app#22", "acme/app#23"]);
    expect(keys(await s.call("GET", "/api/v1/github/items?state=merged"))).toEqual(["acme/app#22"]);
    expect(keys(await s.call("GET", "/api/v1/github/items?limit=2"))).toHaveLength(2);
    expect((await s.call("GET", "/api/v1/github/items?limit=101")).status).toBe(422);
    expect((await s.call("GET", "/api/v1/github/items?kind=bug")).status).toBe(422);
  });

  it("matches a number first, then text in title, labels, author and key", async () => {
    const s = await server();
    expect(keys(await s.call("GET", "/api/v1/github/items?q=%2312&repo=acme/app"))[0]).toBe("acme/app#12");
    expect(keys(await s.call("GET", "/api/v1/github/items?q=22&repo=acme/app"))[0]).toBe("acme/app#22");
    expect(keys(await s.call("GET", "/api/v1/github/items?q=SECURITY"))).toEqual(["acme/app#21", "acme/app#17"]);
    expect(keys(await s.call("GET", "/api/v1/github/items?q=karim"))).toEqual(["acme/app#21", "acme/app#14"]);
  });

  it("only shows repositories mapped to spaces the actor can read", async () => {
    const s = await server();
    const admin = keys(await s.call("GET", "/api/v1/github/items?q=%231"));
    expect(admin).toContain("acme/secret#1");
    // acme/web is not mapped anywhere: nobody sees it, not even an admin.
    expect(keys(await s.call("GET", "/api/v1/github/items?limit=100"))).not.toContain("acme/web#1");
    const reader = await s.token(["read"], ["produit"]);
    const seen = keys(await s.call("GET", "/api/v1/github/items?limit=100", { token: reader }));
    expect(seen).toContain("acme/app#12");
    expect(seen).not.toContain("acme/secret#1");
    expect(seen).not.toContain("acme/default#5");
    const asking = await s.call("GET", "/api/v1/github/items?repo=acme/secret", { token: reader });
    expect(asking.body.items).toEqual([]);
    expect((await s.call("GET", "/api/v1/github/items", { token: null })).status).toBe(401);
  });
});

describe("PUT /api/v1/github/repos", () => {
  const cfg = (s: TestServer) => readFileSync(join(s.root, ".defluance/config.yaml"), "utf8");

  it("links a repository to a space, keeps comments, commits, audits, applies at once and syncs it", async () => {
    const s = await server();
    expect(keys(await s.call("GET", "/api/v1/github/items?repo=acme/web"))).toEqual([]);
    const r = await s.call("PUT", "/api/v1/github/repos", { body: { repo: "ACME/Web", space: "tech", linked: true } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ repo: "acme/web", space: "tech", linked: true, changed: true });
    const text = cfg(s);
    expect(text).toContain("# vault settings");
    expect(text).toContain("# keep me");
    expect(text).toContain("# product");
    expect(text).toContain("acme/web");
    expect((await s.ctx.getConfig()).spaces.find((x) => x.name === "tech")?.repos).toEqual(["acme/web"]);
    expect(s.git("log", "-1", "--format=%s")).toBe("github: link acme/web\n");
    expect(s.git("status", "--porcelain", "--", ".defluance/config.yaml")).toBe("");
    await s.flush();
    expect(keys(await s.call("GET", "/api/v1/github/items?repo=acme/web"))).toEqual(["acme/web#1"]);
    const audit = (await s.call("GET", "/api/v1/audit?limit=5")).body;
    expect(JSON.stringify(audit)).toContain("github.repo.link");
    // Same request again: nothing to do.
    expect((await s.call("PUT", "/api/v1/github/repos", { body: { repo: "acme/web", space: "tech", linked: true } })).body).toMatchObject({ changed: false, commit: null });
  });

  it("links to the default repos without a space, and unlinks", async () => {
    const s = await server();
    await s.call("PUT", "/api/v1/github/repos", { body: { repo: "acme/web", linked: true } });
    expect(cfg(s)).toMatch(/repos: \[acme\/default, acme\/web\]/);
    const r = await s.call("PUT", "/api/v1/github/repos", { body: { repo: "acme/default", linked: false } });
    expect(r.body).toMatchObject({ linked: false, changed: true });
    expect((await s.ctx.getConfig()).repos).toEqual(["acme/web"]);
    expect(s.git("log", "-1", "--format=%s")).toBe("github: unlink acme/default\n");
    expect(cfg(s)).toContain("# keep me");
    const gone = await s.call("PUT", "/api/v1/github/repos", { body: { repo: "acme/app", space: "produit", linked: false } });
    expect(gone.body.changed).toBe(true);
    expect(cfg(s)).toContain("# product");
  });

  it("creates the config file when the vault has none", async () => {
    const s = await server({ files: { "readme.md": FILES["readme.md"] as string } });
    expect((await s.call("PUT", "/api/v1/github/repos", { body: { repo: "acme/web", linked: true } })).status).toBe(200);
    expect(cfg(s)).toContain("acme/web");
    expect((await s.call("PUT", "/api/v1/github/repos", { body: { repo: "acme/web", space: "nope", linked: true } })).status).toBe(422);
  });

  it("refuses unknown spaces, repositories the App cannot see, bad names, non-admins and agents", async () => {
    const s = await server();
    const put = (body: unknown, token?: string | null) => s.call("PUT", "/api/v1/github/repos", { body, ...(token !== undefined ? { token } : {}) });
    expect((await put({ repo: "acme/web", space: "nope", linked: true })).status).toBe(422);
    expect((await put({ repo: "evil/hidden", linked: true })).status).toBe(422);
    expect((await put({ repo: "no-slash", linked: true })).status).toBe(422);
    expect((await put({ repo: "acme/web", linked: true }, await s.token(["read", "write"], ["produit"]))).status).toBe(403);
    expect((await put({ repo: "acme/web", linked: true }, await s.token(["read", "write"]))).status).toBe(403);
    expect((await put({ repo: "acme/web", linked: true }, await s.token(["read", "write", "admin"], ["produit"]))).status).toBe(403);
    expect((await put({ repo: "acme/web", linked: true }, null)).status).toBe(401);
    expect(cfg(s)).toBe(CONFIG);
  });

  it("answers 503 when GitHub is not configured", async () => {
    const s = await server({ github: null });
    expect((await s.call("PUT", "/api/v1/github/repos", { body: { repo: "acme/web", linked: true } })).status).toBe(503);
  });
});

describe("MCP search_github", () => {
  const connect = async (s: TestServer, token: string) => {
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: ((url: string | URL, init?: RequestInit) => s.request(String(url), init)) as typeof fetch,
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport as never);
    return client;
  };
  const items = (r: any): GhNode[] => JSON.parse((r.content as { text: string }[])[0]?.text ?? "{}").items;

  it("finds issues by number and filters, only in readable spaces", async () => {
    const s = await server();
    const admin = await connect(s, s.admin);
    expect(items(await admin.callTool({ name: "search_github", arguments: { q: "#17" } }))[0]?.key).toBe("acme/app#17");
    expect(items(await admin.callTool({ name: "search_github", arguments: { kind: "pull-request", state: "merged" } })).map((n) => n.key)).toEqual(["acme/app#22"]);
    expect(items(await admin.callTool({ name: "search_github", arguments: { q: "falcon" } })).map((n) => n.key)).toEqual(["acme/secret#1"]);
    await admin.close();
    const agent = await connect(s, await s.token(["read"], ["produit"], "agent"));
    expect(items(await agent.callTool({ name: "search_github", arguments: { q: "falcon" } }))).toEqual([]);
    expect(items(await agent.callTool({ name: "search_github", arguments: { q: "reset" } })).length).toBeGreaterThan(0);
    await agent.close();
  });
});
