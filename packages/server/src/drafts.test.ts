import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GithubPort } from "./ports.js";
import { FILES, makeServer, note, type TestServer } from "./test-env.js";

const PATH = "/api/v1/notes/produit%2Fpassword-reset";
const prs: { repo: string; head: string; base: string; title: string }[] = [];
const github: GithubPort = {
  repos: async () => [],
  createIssue: async () => ({ key: "x#1", number: 1, url: "u" }),
  createPullRequest: async (repo, i) => (prs.push({ repo, head: i.head, base: i.base, title: i.title }), { number: 7, url: "https://github.com/acme/vault/pull/7" }),
  handleWebhook: async () => ({ status: 200, message: "ok" }),
  resync: async () => ({ issues: 0, pulls: 0 }),
  comment: async () => undefined,
};

let s: TestServer;
let agent: string;
beforeAll(async () => {
  s = await makeServer({ github, files: { ...FILES, ".defluance/config.yaml": `${FILES[".defluance/config.yaml"]}vault_repo: acme/vault\n` } });
  agent = (await s.call("POST", "/api/v1/tokens", { body: { name: "claude-code", scopes: ["read", "write"], spaces: [] } })).body.token;
});
afterAll(async () => s.cleanup());

const agentEdits = async (addition: string) => {
  const cur = (await s.call("GET", PATH)).body;
  const w = await s.call("PUT", PATH, { token: agent, body: { content: `${cur.raw}\n${addition}\n`, base_commit: cur.commit } });
  expect(w.status).toBe(200);
  return w.body.branch as string;
};

describe("drafts written by agents", () => {
  let branch: string;

  it("lists what an agent wrote, with what it changed and that it still merges", async () => {
    branch = await agentEdits("The agent says the link lasts two hours.");
    expect(branch).toMatch(/^defluance\/claude-code\//);
    const list = (await s.call("GET", "/api/v1/drafts")).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ branch, agent: "claude-code", commits: 1, mergeable: true, files: [{ path: "produit/password-reset.md", id: "produit/password-reset", status: "M", private: false }] });
    const diff = (await s.call("GET", `/api/v1/drafts/diff?branch=${encodeURIComponent(branch)}`)).body;
    expect(diff.files[0].patch).toContain("+The agent says the link lasts two hours.");
    // main is untouched
    expect((await s.call("GET", PATH)).body.raw).not.toContain("two hours");
  });

  it("is hidden from people who cannot read the space, and out of reach of agents and readers", async () => {
    const elsewhere = await s.token(["read", "write", "admin"], ["tech"]);
    expect((await s.call("GET", "/api/v1/drafts", { token: elsewhere })).body).toEqual([]);
    expect((await s.call("GET", `/api/v1/drafts/diff?branch=${encodeURIComponent(branch)}`, { token: elsewhere })).status).toBe(404);
    expect((await s.call("POST", "/api/v1/drafts/merge", { token: agent, body: { branch } })).status).toBe(403);
    const reader = await s.token(["read"], ["produit"]);
    expect((await s.call("POST", "/api/v1/drafts/merge", { token: reader, body: { branch } })).status).toBe(403);
    expect((await s.call("POST", "/api/v1/drafts/discard", { token: reader, body: { branch } })).status).toBe(403);
    expect((await s.call("GET", "/api/v1/drafts/diff?branch=main")).status).toBe(400);
  });

  it("is merged by a person: the note changes, the index follows, the branch goes, the audit says who", async () => {
    const r = await s.call("POST", "/api/v1/drafts/merge", { body: { branch } });
    expect(r.status).toBe(200);
    expect(r.body.merged).toBe(true);
    expect((await s.call("GET", PATH)).body.raw).toContain("two hours");
    expect((await s.call("GET", "/api/v1/search?q=lasts+two+hours")).body[0].note.id).toBe("produit/password-reset");
    expect((await s.call("GET", "/api/v1/drafts")).body).toEqual([]);
    expect(s.git("branch", "--list", "defluance/*").trim()).toBe("");
    const audit = (await s.call("GET", "/api/v1/audit?action=draft.merge")).body;
    expect(audit[0]).toMatchObject({ actor_name: "admin", target: "produit/password-reset" });
  });

  it("refuses to merge over changes made since, and says so before you try", async () => {
    const b = await agentEdits("Agent paragraph.");
    const cur = (await s.call("GET", PATH)).body;
    // a person edits the same place directly
    const lines = cur.raw.split("\n");
    lines[lines.length - 2] = "Human paragraph in the same place.";
    await s.call("PUT", PATH, { body: { content: lines.join("\n"), base_commit: cur.commit } });
    const before = (await s.call("GET", "/api/v1/drafts")).body.find((d: { branch: string }) => d.branch === b);
    expect(before.mergeable).toBe(false);
    const r = await s.call("POST", "/api/v1/drafts/merge", { body: { branch: b } });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe("conflict");
    expect((await s.call("GET", PATH)).body.raw).toContain("Human paragraph in the same place.");
    expect(s.git("status", "--porcelain").split("\n").filter((l) => l && !l.startsWith("??"))).toEqual([]); // nothing left half merged
    expect(() => s.git("rev-parse", "-q", "--verify", "MERGE_HEAD")).toThrow();
    expect((await s.call("POST", "/api/v1/drafts/discard", { body: { branch: b } })).status).toBe(200);
    expect((await s.call("GET", "/api/v1/drafts")).body).toEqual([]);
  });

  it("opens a pull request for a draft once the vault has a remote", async () => {
    const b = await agentEdits("Paragraph for review on GitHub.");
    const missing = await s.call("POST", "/api/v1/drafts/pull-request", { body: { branch: b } });
    expect(missing.status).toBe(422);
    expect(missing.body.title).toMatch(/no remote/);

    const remote = await mkdtemp(join(tmpdir(), "dfl-remote-"));
    execFileSync("git", ["init", "--bare", "-q", remote]);
    s.git("remote", "add", "origin", remote);
    const r = await s.call("POST", "/api/v1/drafts/pull-request", { body: { branch: b } });
    expect(r.status).toBe(201);
    expect(r.body.url).toBe("https://github.com/acme/vault/pull/7");
    expect(prs.at(-1)).toMatchObject({ repo: "acme/vault", head: b, base: "main" });
    expect(execFileSync("git", ["-C", remote, "branch", "--list", b], { encoding: "utf8" })).toContain(b);
    await s.call("POST", "/api/v1/drafts/discard", { body: { branch: b } });
  });
});

describe("private drafts", () => {
  it("show that they changed but not how, and cannot be merged blind", async () => {
    await s.call("POST", "/api/v1/keys", { body: { label: "k", passphrase: "a long passphrase" } });
    const made = await s.call("POST", "/api/v1/tokens", { body: { name: "secret-agent", scopes: ["read", "write"], spaces: [], private_key: true } });
    const agentKey = made.body.key.fp as string;
    const agentToken = made.body.token as string;
    const mine = (await s.call("GET", "/api/v1/keys")).body.mine[0].fp as string;
    await s.call("POST", "/api/v1/notes", { body: { id: "secret/plan", content: note("note", "draft", "# Plan\n\nZEBRAFISH-DRAFT-1"), private: true, recipients: [agentKey] } });
    const path = "/api/v1/notes/secret%2Fplan";
    const cur = (await s.call("GET", path, { token: agentToken })).body;
    expect(cur.locked).toBe(false);
    const w = await s.call("PUT", path, { token: agentToken, body: { content: `${cur.raw}\nMore secret text.\n` } });
    const branch = w.body.branch as string;

    await s.call("POST", "/api/v1/keys/lock");
    const list = (await s.call("GET", "/api/v1/drafts")).body.find((d: { branch: string }) => d.branch === branch);
    expect(list.files[0]).toMatchObject({ id: "secret/plan", private: true });
    const diff = (await s.call("GET", `/api/v1/drafts/diff?branch=${encodeURIComponent(branch)}`)).body;
    expect(diff.files[0].patch).toBe("");
    expect(JSON.stringify(diff)).not.toContain("ZEBRAFISH");
    expect((await s.call("POST", "/api/v1/drafts/merge", { body: { branch } })).status).toBe(423);

    await s.call("POST", `/api/v1/keys/${mine}/unlock`, { body: { passphrase: "a long passphrase" } });
    // the agent's branch version has the agent and the human's key as recipients only if the note was shared with it: the human's key is the original author's, so it opens
    expect((await s.call("POST", "/api/v1/drafts/merge", { body: { branch } })).status).toBe(200);
    expect((await s.call("GET", path)).body.body).toContain("More secret text.");
    expect(await readFile(join(s.root, "secret/plan.md"), "utf8")).not.toContain("ZEBRAFISH");
  });
});
