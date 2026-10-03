import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./index.js";
import { startServe } from "./commands/serve.js";

const note = (type: string, status: string, body: string, extra = "") => `---\ntype: ${type}\nstatus: ${status}\nowner: ana\n${extra}---\n${body}\n`;
const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const EVAL = fileURLToPath(new URL("../../../fixtures/vault-eval", import.meta.url));
const SEMANTIC = fileURLToPath(new URL("../../../fixtures/vault-semantic", import.meta.url));

let dir: string;
let out: string[];
const io = () => ({ out: (l: string) => out.push(l), err: (l: string) => out.push(`ERR ${l}`) });
const cli = (...a: string[]) => run(a, io());

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dfl-e2e-"));
  out = [];
  await mkdir(join(dir, "specs"));
  await writeFile(join(dir, "specs/auth.md"), note("functional-spec", "approved", "# Auth\n\nUsers sign in with a password. See [[sessions|depends_on]].", "acceptance_criteria: []\n"));
  await writeFile(join(dir, "specs/sessions.md"), note("technical-spec", "approved", "# Sessions\n\nCookies expire after fifteen minutes."));
  execFileSync("git", ["-C", dir, "init", "-q", "-b", "main"]);
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"]);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("index, query, token, eval", () => {
  it("index prints counts, query finds notes", async () => {
    expect(await cli("index", dir)).toBe(0);
    expect(out.at(-1)).toBe("2 notes, 2 chunks, 1 links, 2 embedded (hash-512)");
    out = [];
    expect(await cli("query", "cookies", "expire", "--vault", dir)).toBe(0);
    expect(out[0]).toContain("specs/sessions");
    out = [];
    expect(await cli("query", "zzzznothing", "--vault", dir)).toBe(0);
    expect(out).toEqual(["no results"]);
    expect(await cli("index", dir, "--rebuild")).toBe(0);
  });

  it("creates, lists and revokes tokens; the secret is printed once", async () => {
    expect(await cli("token", "create", "ci", "--scopes", "read,write", "--spaces", "default", "--vault", dir)).toBe(0);
    const secret = out.find((l) => l.startsWith("dfl_")) as string;
    expect(secret).toMatch(/^dfl_[\w-]{43}$/);
    out = [];
    await cli("token", "list", "--vault", dir);
    expect(out.join("\n")).toContain("ci  [read,write]  spaces: default");
    expect(out.join("\n")).not.toContain(secret);
    const id = out[0]?.split("  ")[0] as string;
    expect(await cli("token", "revoke", id, "--vault", dir)).toBe(0);
    out = [];
    await cli("token", "list", "--vault", dir);
    expect(out).toEqual([]);
    expect(await cli("token", "create", "--vault", dir)).toBe(2);
    expect(await cli("token", "create", "x", "--scopes", "root", "--vault", dir)).toBe(1);
  });

  it("eval answers the 30-question set with the offline embedder", async () => {
    expect(await cli("eval", join(EVAL, "questions.yaml"), "--vault", EVAL)).toBe(0);
    expect(out.at(-1)).toBe("30/30 passed, 24/24 answers with valid citations (extractive, hash-512)");
  });
});

describe("search commands", () => {
  it("query takes a mode, and rejects an unknown one", async () => {
    expect(await cli("query", "cookies", "expire", "--vault", dir, "--mode", "keyword")).toBe(0);
    expect(out[0]).toContain("specs/sessions");
    out = [];
    expect(await cli("query", "cookies", "--vault", dir, "--mode", "fuzzy")).toBe(2);
    expect(out.join("\n")).toContain('unknown mode "fuzzy"');
    out = [];
    // smart without a model: explains, still searches
    expect(await cli("query", "cookies", "expire", "--vault", dir, "--mode", "smart")).toBe(0);
    expect(out[0]).toContain("no language model configured");
    expect(out.join("\n")).toContain("specs/sessions");
  });

  it("eval --search reports recall and MRR for the offline embedder", async () => {
    expect(await cli("eval", join(SEMANTIC, "questions.yaml"), "--vault", SEMANTIC, "--search", "--mode", "keyword")).toBe(0);
    expect(out.at(-1)).toMatch(/^keyword, hash-512: recall@1 \d+%, recall@3 \d+%, MRR 0\.\d\d over 28 questions; \d\/4 unanswerable/);
  });

  it("models explains its usage", async () => {
    expect(await cli("models")).toBe(2);
    expect(out.join("\n")).toContain("models install");
  });
});

describe("serve", () => {
  it("starts on a free port, prints the one-time sign-in, and serves the API", async () => {
    const running = await startServe(dir, { port: 0 }, io());
    try {
      const text = out.join("\n");
      expect(text).toContain(`Defluance is running at http://127.0.0.1:${running.port}`);
      expect(text).toContain("Sign in:");
      const token = running.bootstrapToken as string;
      expect(text).toContain(`/login#token=${token}`);

      expect((await fetch(`${running.url}/health`)).status).toBe(200);
      expect((await fetch(`${running.url}/api/v1/notes`)).status).toBe(401);
      const list = (await (await fetch(`${running.url}/api/v1/notes`, { headers: { authorization: `Bearer ${token}` } })).json()) as { items: { id: string }[] };
      expect(list.items.map((n) => n.id)).toEqual(["specs/auth", "specs/sessions"]);

      // write through the API: committed, indexed, searchable at once
      const created = await fetch(`${running.url}/api/v1/notes`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ type: "note", title: "Hello", body: "Brand new words.", id: "specs/hello" }) });
      expect(created.status).toBe(201);
      const hits = (await (await fetch(`${running.url}/api/v1/search?q=brand+new`, { headers: { authorization: `Bearer ${token}` } })).json()) as { note: { id: string } }[];
      expect(hits[0]?.note.id).toBe("specs/hello");
    } finally {
      await running.close();
    }
    out = [];
    const again = await startServe(dir, { port: 0 }, io());
    expect(out.join("\n")).not.toContain("Sign in:");
    expect(again.bootstrapToken).toBeNull();
    await again.close();
  });

  it("a fixed DFL_ADMIN_TOKEN is accepted without being printed", async () => {
    const saved = process.env["DFL_ADMIN_TOKEN"];
    process.env["DFL_ADMIN_TOKEN"] = "dfl_fixed_for_compose";
    try {
      const running = await startServe(dir, { port: 0 }, io());
      expect(out.join("\n")).not.toContain("dfl_fixed_for_compose");
      expect((await fetch(`${running.url}/api/v1/me`, { headers: { authorization: "Bearer dfl_fixed_for_compose" } })).status).toBe(200);
      await running.close();
    } finally {
      if (saved === undefined) delete process.env["DFL_ADMIN_TOKEN"];
      else process.env["DFL_ADMIN_TOKEN"] = saved;
    }
  });
});

describe("defluance mcp (stdio, the real binary)", () => {
  it("lets an MCP client search, read and draft on a branch", async () => {
    const client = new Client({ name: "test", version: "1" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN, "mcp", dir], env: { ...process.env, DFL_ACTOR: "claude-code" } as Record<string, string>, stderr: "pipe" }));
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(11);
      const json = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content[0] as { text: string }).text);
      expect(json(await client.callTool({ name: "search", arguments: { query: "cookies expire" } }))[0].note.id).toBe("specs/sessions");
      expect(json(await client.callTool({ name: "read_note", arguments: { id: "specs/auth" } })).links.outgoing["depends_on"][0].target).toBe("sessions");
      const draft = json(await client.callTool({ name: "create_draft", arguments: { title: "Audit trail", type: "functional-spec", body: "Record every change.", id: "specs/audit-trail" } }));
      expect(draft.branch).toBe("defluance/claude-code/specs-audit-trail");
      expect(execFileSync("git", ["-C", dir, "show", `${draft.branch}:specs/audit-trail.md`], { encoding: "utf8" })).toContain("Record every change.");
      expect(execFileSync("git", ["-C", dir, "branch", "--show-current"], { encoding: "utf8" })).toBe("main\n");
    } finally {
      await client.close();
    }
  }, 30_000);
});
