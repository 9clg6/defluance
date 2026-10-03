import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { makeServer, type TestServer } from "./test-env.js";

let s: TestServer;
beforeAll(async () => void (s = await makeServer({ listen: true })));
afterAll(async () => s.cleanup());

interface Client {
  doc: Y.Doc;
  text: Y.Text;
  meta: Y.Map<string>;
  provider: WebsocketProvider;
  close(): void;
}

/** A collaborator: a Yjs document connected like the browser's, with a token instead of a cookie. */
async function join(id: string, token: string | null = s.admin, headers: Record<string, string> = {}): Promise<Client> {
  const doc = new Y.Doc();
  class Authed extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
    }
  }
  const provider = new WebsocketProvider(`${(s.url as string).replace("http", "ws")}/collab`, encodeURIComponent(id), doc, { WebSocketPolyfill: Authed as never, disableBc: true, resyncInterval: -1 });
  await new Promise<void>((resolve, reject) => {
    provider.once("sync", (ok: boolean) => (ok ? resolve() : reject(new Error("not synced"))));
    provider.once("connection-error", () => reject(new Error("connection refused")));
    setTimeout(() => reject(new Error("timeout")), 5000);
  });
  return { doc, text: doc.getText("content"), meta: doc.getMap<string>("meta"), provider, close: () => provider.destroy() };
}

const until = async (cond: () => boolean, what: string, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** Wait for closed sockets to be noticed, then unload the empty rooms. */
const evict = async () => {
  for (let i = 0; i < 40 && s.ctx.collab.roomCount > 0; i++) {
    await new Promise((r) => setTimeout(r, 50));
    await s.ctx.collab.evictIdle();
  }
};
const settle = () => new Promise((r) => setTimeout(r, 120));

const refused = (id: string, token: string | null, headers: Record<string, string> = {}) => join(id, token, headers).then((c) => (c.close(), "connected"), (e: Error) => e.message);

describe("live editing", () => {
  it("starts from the note as committed, with its commit as the base", async () => {
    const a = await join("tech/sessions");
    const note = (await s.call("GET", "/api/v1/notes/tech%2Fsessions")).body;
    expect(a.text.toString()).toBe(note.raw);
    expect(a.meta.get("baseCommit")).toBe(note.commit);
    expect(a.meta.get("base")).toBe(note.raw);
    a.close();
  });

  it("two people see each other's typing at once", async () => {
    const other = await s.token(["read", "write"], [], "nadia");
    const a = await join("tech/sessions");
    const b = await join("tech/sessions", other);
    a.text.insert(a.text.length, "\nWritten by the first.\n");
    await until(() => b.text.toString().includes("Written by the first."), "b to receive a's text");
    b.text.insert(0, "<!-- b -->\n");
    await until(() => a.text.toString().startsWith("<!-- b -->"), "a to receive b's text");
    expect(a.text.toString()).toBe(b.text.toString());
    a.close();
    b.close();
  });

  it("shows who is here, under the name the server knows them by, whatever they claim", async () => {
    const other = await s.token(["read", "write"], [], "nadia");
    const a = await join("tech/sessions");
    const b = await join("tech/sessions", other);
    a.provider.awareness.setLocalStateField("user", { name: "Mallory", color: "#000000" });
    b.provider.awareness.setLocalStateField("user", { name: "whatever", color: "#111111" });
    const others = (c: Client) => [...c.provider.awareness.getStates()].filter(([id, x]) => id !== c.doc.clientID && x["user"]).map(([, x]) => x["user"] as { name: string; color: string });
    await until(() => others(a).length === 1 && others(b).length === 1, "each to see the other");
    // what each sees of the other is what the server says, not what the other claimed
    expect(others(a)[0]?.name).toBe("nadia");
    expect(others(b)[0]?.name).toBe("admin");
    expect(others(a)[0]?.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(others(a)[0]?.color).not.toBe("#111111");
    b.close();
    await until(() => others(a).length === 0, "b to disappear");
    a.close();
  });

  it("lets a reader watch but not change the note", async () => {
    const reader = await s.token(["read"]);
    const a = await join("tech/sessions");
    const r = await join("tech/sessions", reader);
    expect(r.text.toString()).toBe(a.text.toString());
    r.text.insert(0, "SNEAKY ");
    a.text.insert(a.text.length, "\nreal edit\n");
    await until(() => r.text.toString().includes("real edit"), "the reader to receive a's text");
    await new Promise((x) => setTimeout(x, 200));
    expect(a.text.toString()).not.toContain("SNEAKY");
    a.close();
    r.close();
  });

  it("refuses strangers, outsiders, private notes and a cross-site page", async () => {
    expect(await refused("tech/sessions", null)).toBeTruthy();
    expect(await refused("tech/sessions", "dfl_nope")).toBeTruthy();
    const onlyProduit = await s.token(["read", "write"], ["produit"]);
    expect(await refused("tech/sessions", onlyProduit)).toBeTruthy(); // another space: indistinguishable from a missing note
    expect(await refused("does/not-exist", s.admin)).toBeTruthy();

    // private notes have no room: their text must not reach a shared document
    await s.call("POST", "/api/v1/keys", { body: { label: "k", passphrase: "a long passphrase" } });
    await s.call("POST", "/api/v1/notes", { body: { id: "secret/private", type: "note", title: "Private", private: true } });
    expect(await refused("secret/private", s.admin)).toBeTruthy();

    // a browser session on another origin is refused (cross-site WebSocket hijacking)
    const cookie = (await s.call("POST", "/auth/token-login", { token: null, body: { token: s.admin } })).res.headers.get("set-cookie") ?? "";
    const session = /dfl_session=([^;]+)/.exec(cookie)?.[1];
    expect(session).toBeTruthy();
    expect(await refused("tech/sessions", null, { cookie: `dfl_session=${session}`, origin: "https://evil.example" })).toBeTruthy();
    expect(await refused("tech/sessions", null, { cookie: `dfl_session=${session}`, origin: s.url as string })).toBe("connected");
  });

  it("saving through the API moves the base; a change from elsewhere marks the room stale", async () => {
    const a = await join("produit/password-reset");
    const b = await join("produit/password-reset");
    a.text.insert(a.text.length, "\nLive addition.\n");
    await until(() => b.text.toString().includes("Live addition."), "the text to reach b");

    // a presses Save: the editor sends its text with the base it knows
    const saved = await s.call("PUT", "/api/v1/notes/produit%2Fpassword-reset", { body: { content: a.text.toString(), base_commit: a.meta.get("baseCommit") } });
    expect(saved.status).toBe(200);
    // the server recognises the text as the room's own: the base moves forward for everyone
    await until(() => b.meta.get("baseCommit") === saved.body.commit, "b to see the new base");
    expect(b.meta.get("savedBy")).toBe("admin");
    expect(b.meta.get("stale")).toBeUndefined();

    // somebody else changes the note directly, not through the editor
    const now = (await s.call("GET", "/api/v1/notes/produit%2Fpassword-reset")).body;
    const ext = await s.call("PUT", "/api/v1/notes/produit%2Fpassword-reset", { body: { content: `${now.raw}\nFrom the API.\n`, base_commit: now.commit } });
    expect(ext.status).toBe(200);
    await until(() => a.meta.get("stale") === "1", "the room to be marked stale");
    expect(b.meta.get("stale")).toBe("1");
    expect(a.meta.get("current")).toBe(ext.body.commit);
    expect(a.meta.get("baseCommit")).toBe(saved.body.commit); // not moved: saving from here will report a conflict
    const conflict = await s.call("PUT", "/api/v1/notes/produit%2Fpassword-reset", { body: { content: a.text.toString(), base_commit: a.meta.get("baseCommit") } });
    expect(conflict.status).toBe(409);
    a.close();
    b.close();
  });

  it("keeps unsaved text across everyone leaving, and says when the note moved on meanwhile", async () => {
    const id = "readme";
    const enc = encodeURIComponent(id);
    const a = await join(id);
    a.text.insert(a.text.length, "\nDraft nobody saved.\n");
    await settle();
    await s.ctx.collab.flushAll();
    expect(await s.ctx.sys.loadDraft(id)).not.toBeNull();
    a.close();
    await evict();
    expect(s.ctx.collab.roomCount).toBe(0);

    const again = await join(id);
    expect(again.text.toString()).toContain("Draft nobody saved.");
    expect(again.meta.get("stale")).toBeUndefined();
    again.close();
    await evict();

    // the note is changed from outside while nobody has it open
    const cur = (await s.call("GET", `/api/v1/notes/${enc}`)).body;
    await s.call("PUT", `/api/v1/notes/${enc}`, { body: { content: `${cur.raw}\nOutside.\n`, base_commit: cur.commit } });
    const late = await join(id);
    expect(late.text.toString()).toContain("Draft nobody saved.");
    expect(late.meta.get("stale")).toBe("1");
    // saving the draft is refused, not forced over the outside change
    expect((await s.call("PUT", `/api/v1/notes/${enc}`, { body: { content: late.text.toString(), base_commit: late.meta.get("baseCommit") } })).status).toBe(409);
    late.close();
  });

  it("drops the draft once the text equals the committed note", async () => {
    const id = "produit/auth-login";
    const a = await join(id);
    const original = a.text.toString();
    a.text.insert(0, "x");
    await settle();
    await s.ctx.collab.flushAll();
    expect(await s.ctx.sys.loadDraft(id)).not.toBeNull();
    a.text.delete(0, 1);
    await settle();
    await s.ctx.collab.flushAll();
    expect(a.text.toString()).toBe(original);
    expect(await s.ctx.sys.loadDraft(id)).toBeNull();
    a.close();
  });
});
