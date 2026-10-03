import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOOL_NAMES } from "./mcp.js";
import { makeServer, type TestServer } from "./test-env.js";

let s: TestServer;
beforeAll(async () => {
  s = await makeServer();
});
afterAll(() => s.cleanup());

async function connect(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: ((url: string | URL, init?: RequestInit) => s.request(String(url), init)) as typeof fetch,
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport as never);
  return client;
}

const data = (r: any) => JSON.parse((r.content as { text: string }[])[0]?.text ?? "null");

describe("MCP server", () => {
  it("refuses unauthenticated and cookie-authenticated requests", async () => {
    const raw = await s.request("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    expect(raw.status).toBe(401);
    const login = await s.request("/auth/token-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: s.admin }) });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] as string;
    const viaCookie = await s.request("/mcp", { method: "POST", headers: { cookie, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    expect(viaCookie.status).toBe(401);
  });

  it("lists the 10 tools through a real MCP client", async () => {
    const client = await connect(s.admin);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools).toHaveLength(10);
    expect(tools.find((t) => t.name === "create_draft")?.description).toContain("branch");
    await client.close();
  });

  it("searches, reads and walks the graph", async () => {
    const client = await connect(s.admin);
    const hits = data(await client.callTool({ name: "search", arguments: { query: "session cookies expire" } }));
    expect(hits[0].note.id).toBe("tech/sessions");
    const read = data(await client.callTool({ name: "read_note", arguments: { id: "produit/auth-login" } }));
    expect(read.note.title).toBe("Login");
    expect(read.links.outgoing["depends_on"][0].target).toBe("tech/sessions");
    const impact = data(await client.callTool({ name: "graph_impact", arguments: { id: "tech/sessions" } }));
    expect(impact.notes.map((n: { id: string }) => n.id)).toContain("produit/auth-login");
    const answer = data(await client.callTool({ name: "ask", arguments: { question: "How long do session cookies last?" } }));
    expect(answer.citations[0].note).toBe("tech/sessions");
    await client.close();
  });

  it("an agent token creates drafts on a branch and cannot approve", async () => {
    const agent = await s.token(["read", "write"], ["produit"], "claude-code");
    const client = await connect(agent);
    const head = s.git("rev-parse", "HEAD");
    const r = data(await client.callTool({ name: "create_draft", arguments: { title: "Notifications", type: "functional-spec", body: "Send an email on mention.", id: "produit/notifications" } }));
    expect(r.branch).toBe("defluance/claude-code/produit-notifications");
    expect(s.git("rev-parse", "HEAD")).toBe(head);
    expect(s.git("show", `${r.branch}:produit/notifications.md`)).toContain("status: draft");

    const bad = await client.callTool({ name: "update_note", arguments: { id: "produit/password-reset", content: "---\ntype: note\nstatus: approved\nowner: x\n---\n# x" } });
    expect(bad.isError).toBe(true);
    expect((bad.content as { text: string }[])[0]?.text).toContain("agents cannot set status");
    await client.close();
  });

  it("enforces scopes and spaces, with the same rules as REST", async () => {
    const reader = await connect(await s.token(["read"], ["produit"]));
    const denied = await reader.callTool({ name: "create_draft", arguments: { title: "X", type: "note", id: "produit/x" } });
    expect(denied.isError).toBe(true);
    expect((denied.content as { text: string }[])[0]?.text).toContain('requires "write"');
    const hidden = await reader.callTool({ name: "read_note", arguments: { id: "secret/plans" } });
    expect(hidden.isError).toBe(true);
    expect(data(await reader.callTool({ name: "search", arguments: { query: "Falcon" } }))).toEqual([]);
    await reader.close();
  });

  it("links notes and records the call in the audit log", async () => {
    const client = await connect(await s.token(["read", "write"], ["produit", "tech"], "linker"));
    const r = data(await client.callTool({ name: "link_notes", arguments: { from: "produit/password-reset", to: "tech/sessions", type: "depends_on" } }));
    expect(r.branch).toBe("defluance/linker/produit-password-reset");
    const log = (await s.call("GET", "/api/v1/audit?actor=linker")).body as { action: string }[];
    expect(log.map((e) => e.action)).toContain("note.link");
    await client.close();
  });

  it("reports GitHub as not configured instead of crashing", async () => {
    const client = await connect(s.admin);
    const r = await client.callTool({ name: "create_issue", arguments: { id: "produit/auth-login" } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]?.text).toContain("not configured");
    await client.close();
  });

  it("answers 405 to GET and counts calls in /metrics", async () => {
    const res = await s.request("/mcp", { method: "GET", headers: { authorization: `Bearer ${s.admin}` } });
    expect(res.status).toBe(405);
    const metrics = await (await s.request("/metrics")).text();
    expect(metrics).toContain('defluance_mcp_calls_total{outcome="ok",tool="search"}');
    expect(metrics).toContain("defluance_notes ");
  });
});
