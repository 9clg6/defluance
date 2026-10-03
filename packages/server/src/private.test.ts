import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KeyService } from "./keys.js";
import { makeServer, note, type TestServer } from "./test-env.js";

const MARKER = "ZEBRAFISH-SECRET-42";
/** Text of a note that was plain before it was encrypted: it can legitimately remain in git history. */
const WAS_PLAIN = "PLAINWAS-7";
const PASS = "correct horse battery";

let s: TestServer;
let alice: string; // key fingerprint of the admin token holder
const call = (m: string, p: string, o?: Parameters<TestServer["call"]>[2]) => s.call(m, p, o);

beforeAll(async () => {
  s = await makeServer();
  const k = await call("POST", "/api/v1/keys", { body: { label: "Admin key", passphrase: PASS } });
  expect(k.status).toBe(201);
  alice = k.body.fp;
});
afterAll(async () => s.cleanup());

const unlock = (fp = alice, passphrase = PASS, token?: string) => call("POST", `/api/v1/keys/${fp}/unlock`, { body: { passphrase }, ...(token ? { token } : {}) });
const lock = () => call("POST", "/api/v1/keys/lock");

describe("keys", () => {
  it("lists your keys and publishes the public part in the vault keyring", async () => {
    const r = await call("GET", "/api/v1/keys");
    expect(r.body.mine).toMatchObject([{ fp: alice, label: "Admin key", bound: "passphrase", unlocked: false }]);
    expect(r.body.keyring.map((k: { fp: string }) => k.fp)).toContain(alice);
    const file = JSON.parse(await readFile(join(s.root, `.defluance/keys/${alice}.json`), "utf8"));
    expect(file.pem).toContain("BEGIN PUBLIC KEY");
    expect(JSON.stringify(file)).not.toContain("PRIVATE");
    expect(s.git("log", "--format=%s", "-1", "--", `.defluance/keys/${alice}.json`).trim()).toBe("add public key Admin key");
  });

  it("refuses a short passphrase and keys for agents", async () => {
    expect((await call("POST", "/api/v1/keys", { body: { label: "x", passphrase: "short" } })).status).toBe(422);
    const agent = await s.token(["read", "write"]);
    expect((await call("POST", "/api/v1/keys", { token: agent, body: { label: "x", passphrase: PASS + PASS } })).status).toBe(403);
  });

  it("unlocks with the right passphrase, refuses a wrong one, and locks out after five", async () => {
    const wrong = await unlock(alice, "not the passphrase");
    expect(wrong.status).toBe(403);
    expect((await unlock()).body).toMatchObject({ fp: alice, unlocked: true });
    expect((await call("GET", "/api/v1/keys")).body.mine[0].unlocked).toBe(true);
    await lock();
    expect((await call("GET", "/api/v1/keys")).body.mine[0].unlocked).toBe(false);

    const t2 = await makeServer();
    try {
      const k = (await t2.call("POST", "/api/v1/keys", { body: { label: "k", passphrase: PASS } })).body.fp;
      for (let i = 0; i < 5; i++) expect((await t2.call("POST", `/api/v1/keys/${k}/unlock`, { body: { passphrase: `wrong ${i} wrong` } })).status).toBe(403);
      const locked = await t2.call("POST", `/api/v1/keys/${k}/unlock`, { body: { passphrase: PASS } });
      expect(locked.status).toBe(429);
      expect(locked.body.retry_after).toBeGreaterThan(0);
      const audit = (await t2.call("GET", "/api/v1/audit?action=key.unlock.failed")).body;
      expect(audit.length).toBe(6);
      expect(JSON.stringify(audit)).not.toContain("wrong 0");
    } finally {
      await t2.cleanup();
    }
  });

  it("cannot unlock somebody else's key", async () => {
    const other = await s.token(["read", "write", "admin"]);
    expect((await unlock(alice, PASS, other)).status).toBe(404);
  });

  it("forgets an unlocked key after it has been idle, and after a maximum time even when used", async () => {
    let clock = 1_000_000;
    const keys = new KeyService(s.ctx.sys, s.root, () => new Date(clock), { bits: 2048, kdfN: 2 ** 14, idleMs: 1000, maxMs: 5000 });
    const row = await keys.create({ kind: "user", id: "u1" }, { label: "u1", passphrase: PASS, bound: "passphrase", author: { name: "t", email: "t@t" } });
    await keys.unlock("u1", row.fp, PASS);
    expect(keys.heldBy("u1")).toHaveLength(1);
    clock += 900;
    expect(keys.heldBy("u1")).toHaveLength(1); // using it keeps it
    clock += 900;
    expect(keys.heldBy("u1")).toHaveLength(1);
    clock += 1500; // idle for longer than idleMs
    expect(keys.heldBy("u1")).toHaveLength(0);

    await keys.unlock("u1", row.fp, PASS);
    for (let i = 0; i < 6; i++) {
      clock += 900;
      if (i < 5) expect(keys.heldBy("u1")).toHaveLength(1);
    }
    expect(keys.heldBy("u1")).toHaveLength(0); // 5.4 s since unlock: past maxMs although it was used all along
  });

  it("drops the decrypted notes of a key nobody uses any more", async () => {
    await unlock();
    await call("POST", "/api/v1/notes", { body: { id: "secret/sweep", content: note("note", "draft", "# Sweep\n\nsome text"), private: true } });
    await call("GET", "/api/v1/search?q=sweep"); // reading with the unlocked key fills the private index
    expect(s.ctx.priv.cached(alice)).toBeGreaterThan(0);
    s.ctx.priv.sweep(60_000);
    expect(s.ctx.priv.cached(alice)).toBeGreaterThan(0); // used a moment ago: kept
    s.ctx.priv.sweep(1_000, Date.now() + 61_000);
    expect(s.ctx.priv.cached(alice)).toBe(0); // idle: forgotten
    await lock();
  });
});

describe("private notes", () => {
  const id = "secret/falcon";
  let commit: string;

  it("encrypts on creation: the file and the index hold no text", async () => {
    await unlock();
    const r = await call("POST", "/api/v1/notes", { body: { id, content: note("technical-spec", "draft", `# Acquisition of Falcon\n\nThe board approved ${MARKER} on Monday. See [[produit/auth-login|depends_on]].`, "tags: [m-and-a]\n"), private: true } });
    expect(r.status).toBe(201);
    commit = r.body.commit;
    const file = await readFile(join(s.root, `${id}.md`), "utf8");
    expect(file).toContain("encrypted:");
    expect(file).not.toContain(MARKER);
    expect(file).not.toContain("Falcon");
    expect(file).toMatch(/^type: technical-spec$/m);
    expect(s.git("log", "--format=%s", "-1", "--", `${id}.md`).trim()).toBe(`add ${id}`);
  });

  it("is readable while the key is unlocked, with its recipients named", async () => {
    const r = await call("GET", `/api/v1/notes/${encodeURIComponent(id)}`);
    expect(r.body).toMatchObject({ private: true, locked: false, title: "Acquisition of Falcon", tags: ["m-and-a"] });
    expect(r.body.body).toContain(MARKER);
    expect(r.body.recipients).toEqual([{ fp: alice, label: "Admin key", owner: expect.stringContaining("token:") }]);
    expect(r.body.commit).toBe(commit);
    const links = (await call("GET", `/api/v1/notes/${encodeURIComponent(id)}/links`)).body;
    expect(links.outgoing["depends_on"][0].note).toMatchObject({ id: "produit/auth-login" });
  });

  it("shows the real title in lists while unlocked", async () => {
    const list = (await call("GET", "/api/v1/notes?space=secret")).body.items;
    expect(list.find((n: { id: string }) => n.id === id)).toMatchObject({ private: true, locked: false, title: "Acquisition of Falcon" });
  });

  it("is found by words, with the rest of the vault, and by an answer", async () => {
    const hits = (await call("GET", `/api/v1/search?q=${encodeURIComponent("board approved zebrafish")}`)).body;
    expect(hits[0]).toMatchObject({ private: true, note: { id, title: "Acquisition of Falcon" } });
    expect(hits[0].chunk.snippet).toContain(MARKER);
    const mixed = (await call("GET", `/api/v1/search?q=${encodeURIComponent("sessions")}`)).body;
    expect(mixed.some((h: { private?: boolean }) => h.private)).toBe(false);
    expect(mixed.length).toBeGreaterThan(0);
    const filtered = (await call("GET", "/api/v1/search?q=board&tag=m-and-a")).body;
    expect(filtered.map((h: { note: { id: string } }) => h.note.id)).toEqual([id]);
    const answer = (await call("POST", "/api/v1/ask", { body: { question: "what did the board approve on Monday?" } })).body;
    expect(answer.refused).toBe(false);
    expect(answer.citations[0].note).toBe(id);
  });

  it("is locked again as soon as the key is locked: no text, no search hit", async () => {
    await lock();
    const r = (await call("GET", `/api/v1/notes/${encodeURIComponent(id)}`)).body;
    expect(r).toMatchObject({ private: true, locked: true, reason: "locked", body: "", raw: "", headings: [], frontmatter: { type: "technical-spec", status: "draft" } });
    expect(JSON.stringify(r)).not.toContain(MARKER);
    expect((await call("GET", `/api/v1/search?q=zebrafish`)).body).toEqual([]);
    const list = (await call("GET", "/api/v1/notes?space=secret")).body.items.find((n: { id: string }) => n.id === id);
    expect(list).toMatchObject({ private: true, locked: true, title: "falcon" });
    expect((await call("PUT", `/api/v1/notes/${encodeURIComponent(id)}`, { body: { content: note("technical-spec", "draft", "# overwritten") } })).status).toBe(423);
  });

  it("an actor without a recipient key learns only that the note is private", async () => {
    const other = await s.token(["read", "write"], ["secret"]);
    const r = (await call("GET", `/api/v1/notes/${encodeURIComponent(id)}`, { token: other })).body;
    expect(r).toMatchObject({ private: true, locked: true, reason: "no-key", body: "" });
    expect((await call("GET", `/api/v1/search?q=zebrafish`, { token: other })).body).toEqual([]);
  });

  it("editing, status and links keep the note encrypted, and the history shows no ciphertext diff", async () => {
    await unlock();
    const path = `/api/v1/notes/${encodeURIComponent(id)}`;
    const cur = (await call("GET", path)).body;
    const upd = await call("PUT", path, { body: { content: `${cur.raw}\nA second paragraph about ${MARKER}.\n`, base_commit: cur.commit } });
    expect(upd.status).toBe(200);
    expect((await call("PATCH", `${path}/status`, { body: { status: "review" } })).status).toBe(200);
    expect((await call("POST", `${path}/links`, { body: { to: "tech/sessions", type: "related" } })).status).toBe(201);
    const file = await readFile(join(s.root, `${id}.md`), "utf8");
    expect(file).toContain("encrypted:");
    expect(file).not.toContain(MARKER);
    expect(file).toMatch(/^status: review$/m);
    const after = (await call("GET", path)).body;
    expect(after.body).toContain("A second paragraph");
    expect(after.frontmatter.status).toBe("review");
    expect(Object.keys((await call("GET", `${path}/links`)).body.outgoing)).toEqual(expect.arrayContaining(["depends_on", "related"]));
    const hist = (await call("GET", `${path}/history`)).body;
    const patch = await call("GET", `${path}/history?diff=${hist.commits[0].hash}`);
    expect(patch.body).toMatchObject({ patch: "", private: true });
    expect(s.git("log", "--format=%s", "--", `${id}.md`)).not.toMatch(/zebrafish|acquisition|board/i);
  });

  it("refuses to send a private note to GitHub", async () => {
    expect((await call("POST", `/api/v1/notes/${encodeURIComponent(id)}/issues`, { body: {} })).status).toBe(422);
  });

  it("keeps a stale editor from overwriting: a changed note still answers 409", async () => {
    const path = `/api/v1/notes/${encodeURIComponent(id)}`;
    const cur = (await call("GET", path)).body;
    const r = await call("PUT", path, { body: { content: cur.raw, base_commit: commit } });
    expect(r.status).toBe(409);
  });
});

describe("recipients", () => {
  it("adds a person who can then read the note, and removing them re-encrypts it", async () => {
    await unlock();
    const bobToken = await s.token(["read", "write", "admin"], [], "bob");
    const bobKey = (await call("POST", "/api/v1/keys", { token: bobToken, body: { label: "Bob", passphrase: "bob has a long passphrase" } })).body.fp;
    const id = "secret/shared";
    const path = `/api/v1/notes/${encodeURIComponent(id)}`;
    await call("POST", "/api/v1/notes", { body: { id, content: note("note", "draft", `# Shared\n\n${MARKER}`), private: true } });

    expect((await call("GET", path, { token: bobToken })).body).toMatchObject({ locked: true, reason: "no-key" }.reason ? { locked: true } : {});
    const before = await readFile(join(s.root, `${id}.md`), "utf8");

    const add = await call("PUT", `${path}/recipients`, { body: { add: [bobKey] } });
    expect(add.status).toBe(200);
    expect(add.body.recipients).toContain(bobKey);
    const added = await readFile(join(s.root, `${id}.md`), "utf8");
    // adding wraps the note key again: the ciphertext itself is untouched
    expect(added.split("---\n").at(-1)).toBe(before.split("---\n").at(-1));

    expect((await call("POST", `/api/v1/keys/${bobKey}/unlock`, { token: bobToken, body: { passphrase: "bob has a long passphrase" } })).status).toBe(200);
    expect((await call("GET", path, { token: bobToken })).body).toMatchObject({ locked: false, body: expect.stringContaining(MARKER) });
    expect((await call("GET", `/api/v1/search?q=zebrafish`, { token: bobToken })).body[0]).toMatchObject({ private: true, note: { id } });

    const removed = await call("PUT", `${path}/recipients`, { body: { remove: [bobKey] } });
    expect(removed.body.recipients).toEqual([alice]);
    const rotated = await readFile(join(s.root, `${id}.md`), "utf8");
    expect(rotated.split("---\n").at(-1)).not.toBe(added.split("---\n").at(-1));
    expect((await call("GET", path, { token: bobToken })).body).toMatchObject({ locked: true });
    expect((await call("PUT", `${path}/recipients`, { body: { remove: [alice] } })).status).toBe(422);
  });

  it("encrypts a note that was plain, with a warning about history, and can make it plain again", async () => {
    const id = "secret/was-plain";
    const path = `/api/v1/notes/${encodeURIComponent(id)}`;
    await call("POST", "/api/v1/notes", { body: { id, content: note("note", "draft", `# Was plain\n\n${WAS_PLAIN}`) } });
    const r = await call("POST", `${path}/encrypt`, { body: {} });
    expect(r.status).toBe(200);
    expect(r.body.warning).toMatch(/git history/);
    expect(await readFile(join(s.root, `${id}.md`), "utf8")).not.toContain(WAS_PLAIN);
    expect(s.git("log", "-p", "--", `${id}.md`)).toContain(WAS_PLAIN); // honest: the old version is still there
    expect((await call("POST", `${path}/encrypt`, { body: {} })).status).toBe(409);
    expect((await call("POST", `${path}/decrypt`)).status).toBe(200);
    expect(await readFile(join(s.root, `${id}.md`), "utf8")).toContain(WAS_PLAIN);
  });
});

describe("agents with a key of their own", () => {
  it("unlocks with its token alone, reads what was shared with it and nothing else", async () => {
    await unlock();
    const made = await call("POST", "/api/v1/tokens", { body: { name: "claude-code", scopes: ["read", "write"], spaces: [], private_key: true } });
    expect(made.status).toBe(201);
    const agentKey = made.body.key.fp as string;
    const agent = made.body.token as string;

    await call("POST", "/api/v1/notes", { body: { id: "secret/for-agent", content: note("note", "draft", `# For the agent\n\n${MARKER}-AGENT`), private: true, recipients: [agentKey] } });
    const path = `/api/v1/notes/${encodeURIComponent("secret/for-agent")}`;
    const read = (await call("GET", path, { token: agent })).body;
    expect(read).toMatchObject({ locked: false });
    expect(read.body).toContain(`${MARKER}-AGENT`);
    // the one shared with the human only is not readable by the agent
    expect((await call("GET", `/api/v1/notes/${encodeURIComponent("secret/falcon")}`, { token: agent })).body).toMatchObject({ locked: true, reason: "not-recipient" });
    const found = (await call("GET", `/api/v1/search?q=${MARKER}`, { token: agent })).body.map((h: { note: { id: string } }) => h.note.id);
    expect(found).toContain("secret/for-agent");
    expect(found).not.toContain("secret/falcon");
    expect(found).not.toContain("secret/shared");

    // an agent writes to a branch, and what it writes is encrypted too
    const w = await call("PUT", path, { token: agent, body: { content: `${read.raw}\nAgent addition ${MARKER}-AGENT-2\n` } });
    expect(w.status).toBe(200);
    expect(w.body.branch).toMatch(/^defluance\//);
    expect(s.git("show", `${w.body.branch}:secret/for-agent.md`)).not.toContain(MARKER);

    // revoking the token drops its access at once
    await call("DELETE", `/api/v1/tokens/${made.body.id}`);
    expect((await call("GET", path, { token: agent })).status).toBe(401);
  });
});

describe("nothing leaks", () => {
  it("the marker is nowhere on disk, in git, in the database, in logs or in the audit log", async () => {
    await unlock();
    const files: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.name === ".git") continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else files.push(p);
      }
    };
    await walk(s.root);
    // the working tree, which includes the SQLite database and its write-ahead log
    expect(files.some((f) => f.includes(".sqlite"))).toBe(true);
    const offenders: string[] = [];
    for (const f of files) if ((await readFile(f)).toString("latin1").includes("ZEBRAFISH")) offenders.push(f);
    expect(offenders).toEqual([]);

    // every blob in git, in every commit and branch
    const blobs = execFileSync("git", ["-C", s.root, "cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype)"], { encoding: "utf8" })
      .split("\n").filter((l) => l.endsWith(" blob")).map((l) => l.split(" ")[0] as string);
    expect(blobs.length).toBeGreaterThan(10);
    const leaking = blobs.filter((b) => execFileSync("git", ["-C", s.root, "cat-file", "blob", b], { encoding: "latin1", maxBuffer: 50_000_000 }).includes("ZEBRAFISH"));
    expect(leaking).toEqual([]);

    const audit = JSON.stringify((await call("GET", "/api/v1/audit?limit=500")).body);
    for (const secret of [MARKER, PASS, "bob has a long passphrase"]) {
      expect(audit).not.toContain(secret);
      expect(s.logs.join("\n")).not.toContain(secret);
    }
    expect(await (await s.request("/metrics")).text()).not.toContain(MARKER);
  });

  it("API answers are never cached", async () => {
    expect((await call("GET", "/api/v1/notes")).res.headers.get("cache-control")).toBe("no-store");
  });
});
