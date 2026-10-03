import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Llm } from "@defluance/ai";
import { createMockLlm } from "@defluance/ai";
import { FILES, makeServer, note, type TestServer } from "./test-env.js";

const enc = encodeURIComponent;
const PASS = "correct horse battery";

/** A model that answers from a script and records every prompt it was given. */
function scripted(...replies: string[]): Llm & { prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  return { id: "fake:writer", prompts, generate: async (_s, p) => (prompts.push(p), replies[Math.min(i++, replies.length - 1)] as string) };
}
const draft = (extra = "", body = "# Login\n\nUsers sign in. See [[tech/sessions|depends_on]].") => note("functional-spec", "approved", body, `acceptance_criteria: []\n${extra ? `${extra}\n` : ""}`);

describe("POST /notes/{id}/generate", () => {
  let s: TestServer;
  let llm: ReturnType<typeof scripted>;
  const gen = (id: string, body: unknown, token?: string) => s.call("POST", `/api/v1/notes/${enc(id)}/generate`, { body, ...(token ? { token } : {}) });
  beforeAll(async () => {
    llm = scripted("");
    s = await makeServer({ llm, files: FILES });
  });
  afterAll(() => s.cleanup());

  it("returns a proposal with grounding, links and the model id, and writes nothing", async () => {
    llm = scripted(draft("tags: [auth]"));
    s.ctx.llm = llm;
    const before = s.git("rev-parse", "HEAD");
    const r = await gen("produit/auth-login", { mode: "fill", instruction: "add lockout rules" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ model: "fake:writer", warnings: [], links: [{ to: "tech/sessions", type: "depends_on" }] });
    expect(r.body.content).toContain("tags: [auth]");
    expect(r.body.grounded_on.map((g: { id: string }) => g.id)).toEqual(expect.arrayContaining(["tech/sessions", "produit/password-reset"]));
    expect(r.body.grounded_on.map((g: { id: string }) => g.id)).not.toContain("produit/auth-login");
    expect(s.git("rev-parse", "HEAD")).toBe(before);
    expect(llm.prompts[0]).toContain("add lockout rules");
    expect(llm.prompts[0]).toContain("Signed JWT cookies expire"); // a linked note's text
    expect(llm.prompts[0]).toContain("<template>");
  });

  it("uses the unsaved content instead of the stored text, and the template with its hints", async () => {
    await s.call("PUT", `/api/v1/templates/functional-spec`, { body: { content: "---\ntype: {{type}}\nstatus: draft\nowner: {{owner}}\nacceptance_criteria: []\n---\n\n# {{title}}\n\n## Context\n<!-- ai: explain why now -->\n" } });
    llm = scripted(draft());
    s.ctx.llm = llm;
    const r = await gen("produit/auth-login", { mode: "improve", content: note("functional-spec", "draft", "# Login\n\nUNSAVED-EDIT-TEXT", "acceptance_criteria: []\n") });
    expect(r.status).toBe(200);
    expect(llm.prompts[0]).toContain("UNSAVED-EDIT-TEXT");
    expect(llm.prompts[0]).not.toContain("Users sign in with email");
    expect(llm.prompts[0]).toContain("<!-- ai: explain why now -->");
    expect(llm.prompts[0]).toContain("Task: improve");
    await s.call("DELETE", `/api/v1/templates/functional-spec`);
  });

  it("strips a code fence wrapped around the whole answer", async () => {
    llm = scripted("```markdown\n" + draft() + "```");
    s.ctx.llm = llm;
    const r = await gen("produit/auth-login", { mode: "fill" });
    expect(r.status).toBe(200);
    expect(r.body.content.startsWith("---\ntype: functional-spec")).toBe(true);
    expect(r.body.content).not.toContain("```");
  });

  it("never lets the model approve a note", async () => {
    llm = scripted(note("functional-spec", "approved", "# Login\n\nText.", "acceptance_criteria: []\n").replace("owner: ana", "owner: mallory"));
    s.ctx.llm = llm;
    const r = await gen("produit/password-reset", { mode: "improve" }); // stored status: draft, owner: ana
    expect(r.status).toBe(200);
    expect(r.body.content).toMatch(/^status: draft$/m);
    expect(r.body.content).toMatch(/^owner: ana$/m);
    expect(r.body.content).not.toContain("mallory");
    expect(r.body.warnings.join("\n")).toMatch(/restored to "draft"/);
  });

  it("removes links to missing notes and says so", async () => {
    llm = scripted(note("functional-spec", "draft", "# Login\n\nSee [[tech/sessions|depends_on]] and [[nowhere/ghost|blocks]].", 'acceptance_criteria: []\nlinks:\n  - "[[ghost/two|related]]"\n'));
    s.ctx.llm = llm;
    const r = await gen("produit/auth-login", { mode: "fill" });
    expect(r.body.content).not.toContain("[[nowhere/ghost");
    expect(r.body.content).not.toContain("ghost/two|");
    expect(r.body.warnings).toEqual(expect.arrayContaining(['removed a link to "nowhere/ghost": no such note', 'removed a link to "ghost/two": no such note']));
    expect(r.body.links).toEqual([{ to: "tech/sessions", type: "depends_on" }]);
  });

  it("retries once when the output does not parse, then answers 422", async () => {
    llm = scripted("no frontmatter at all", draft());
    s.ctx.llm = llm;
    expect((await gen("produit/auth-login", { mode: "fill" })).status).toBe(200);
    expect(llm.prompts).toHaveLength(2);
    llm = scripted("still nothing", "nor here");
    s.ctx.llm = llm;
    const bad = await gen("produit/auth-login", { mode: "fill" });
    expect(bad.status).toBe(422);
    expect(bad.body.title).toMatch(/did not return a valid note/);
    expect(llm.prompts).toHaveLength(2);
  });

  it("answers 502 when the model fails", async () => {
    s.ctx.llm = { id: "fake:down", generate: async () => { throw new Error("quota"); } };
    const r = await gen("produit/auth-login", { mode: "fill" });
    expect(r.status).toBe(502);
    expect(r.body.title).toMatch(/quota/);
  });

  it("audits id, mode and model, never the text", async () => {
    llm = scripted(draft("tags: [AUDITMARKER]"));
    s.ctx.llm = llm;
    await gen("produit/auth-login", { mode: "improve", instruction: "INSTRUCTIONMARKER" });
    const entries = (await s.call("GET", "/api/v1/audit?action=note.generate")).body as { target: string; payload: Record<string, unknown> }[];
    expect(entries.find((e) => e.payload["mode"] === "improve")).toMatchObject({ target: "produit/auth-login", payload: { mode: "improve", model: "fake:writer" } });
    expect(JSON.stringify(entries)).not.toMatch(/AUDITMARKER|INSTRUCTIONMARKER/);
  });

  it("checks permissions: write on the space, no agents, no unknown or hidden notes", async () => {
    s.ctx.llm = scripted(draft());
    const reader = await s.token(["read"], ["produit"]);
    expect((await gen("produit/auth-login", { mode: "fill" }, reader)).status).toBe(403);
    const agent = await s.token(["read", "write"], ["produit"]);
    const a = await gen("produit/auth-login", { mode: "fill" }, agent);
    expect(a.status).toBe(403);
    expect(a.body.title).toMatch(/agents/);
    const other = await s.token(["read", "write", "admin"], ["tech"]);
    expect((await gen("produit/auth-login", { mode: "fill" }, other)).status).toBe(404);
    expect((await gen("produit/missing", { mode: "fill" })).status).toBe(404);
    expect((await gen("produit/auth-login", { mode: "nope" })).status).toBe(422);
    expect((await gen("produit/auth-login", { mode: "fill", instruction: "x".repeat(4001) })).status).toBe(422);
    expect((await s.call("POST", `/api/v1/notes/${enc("produit/auth-login")}/generate`, { token: null, body: { mode: "fill" } })).status).toBe(401);
  });

  it("does not show notes of spaces the writer cannot read to the model", async () => {
    llm = scripted(draft());
    s.ctx.llm = llm;
    const writer = await s.token(["read", "write", "admin"], ["produit"]);
    await gen("produit/auth-login", { mode: "fill", instruction: "plans" }, writer);
    expect(llm.prompts[0]).not.toContain("codename Falcon");
    llm = scripted(draft());
    s.ctx.llm = llm;
    await gen("produit/auth-login", { mode: "fill", instruction: "plans" }); // an admin of every space may
    expect(llm.prompts[0]).toContain("Acquisition target codename Falcon");
  });

  it("works with the demo model", async () => {
    s.ctx.llm = createMockLlm();
    const r = await gen("produit/password-reset", { mode: "fill", instruction: "Reset by email." });
    expect(r.status).toBe(200);
    expect(r.body.model).toBe("mock:demo");
    expect(r.body.content).toContain("type: functional-spec");
    expect(r.body.content).toContain("## Requirements");
    expect(r.body.content).toMatch(/^status: draft$/m);
  });
});

describe("generate without a model, and private notes", () => {
  it("answers 503 with a clear message when no model is configured", async () => {
    const s = await makeServer();
    try {
      const r = await s.call("POST", `/api/v1/notes/${enc("produit/auth-login")}/generate`, { body: { mode: "fill" } });
      expect(r.status).toBe(503);
      expect(r.body.title).toBe("no language model configured: set DFL_LLM");
    } finally {
      await s.cleanup();
    }
  });

  async function privateSetup(env: Record<string, string>) {
    const llm = scripted(note("note", "draft", "# Plans\n\nImproved."));
    const s = await makeServer({ llm, env });
    const k = await s.call("POST", "/api/v1/keys", { body: { label: "k", passphrase: PASS } });
    const created = await s.call("POST", "/api/v1/notes", { body: { id: "secret/mine", content: note("note", "draft", "# Mine\n\nPRIVATE-TEXT-77 and [[produit/auth-login]]."), private: true } });
    expect(created.status).toBe(201);
    return { s, llm, fp: k.body.fp as string, unlock: () => s.call("POST", `/api/v1/keys/${k.body.fp}/unlock`, { body: { passphrase: PASS } }) };
  }
  const gen = (s: TestServer, body: unknown = { mode: "improve" }) => s.call("POST", `/api/v1/notes/${enc("secret/mine")}/generate`, { body });

  it("refuses a private note unless the operator allowed it, even when unlocked", async () => {
    const { s, llm, unlock } = await privateSetup({});
    try {
      await unlock();
      const r = await gen(s);
      expect(r.status).toBe(422);
      expect(r.body.title).toMatch(/DFL_PRIVATE_LLM=allow/);
      expect(llm.prompts).toHaveLength(0);
    } finally {
      await s.cleanup();
    }
  });

  it("with the gate open it needs the key unlocked, then uses the plaintext", async () => {
    const { s, llm, unlock } = await privateSetup({ DFL_PRIVATE_LLM: "allow" });
    try {
      const locked = await gen(s);
      expect(locked.status).toBe(423);
      expect(llm.prompts).toHaveLength(0);
      await unlock();
      const r = await gen(s);
      expect(r.status).toBe(200);
      expect(llm.prompts[0]).toContain("PRIVATE-TEXT-77");
      expect(r.body.content).toContain("Improved.");
    } finally {
      await s.cleanup();
    }
  });

  it("never gives a private note to the model as context for another note", async () => {
    const { s, llm, unlock } = await privateSetup({ DFL_PRIVATE_LLM: "allow" });
    try {
      await unlock();
      s.ctx.llm = scripted(note("functional-spec", "draft", "# Login\n\nText.", "acceptance_criteria: []\n"));
      const spy = s.ctx.llm as ReturnType<typeof scripted>;
      const r = await s.call("POST", `/api/v1/notes/${enc("produit/auth-login")}/generate`, { body: { mode: "fill", instruction: "Mine" } });
      expect(r.status).toBe(200);
      expect(spy.prompts[0]).not.toContain("PRIVATE-TEXT-77");
      expect(r.body.grounded_on.map((g: { id: string }) => g.id)).not.toContain("secret/mine");
      expect(llm.prompts).toHaveLength(0);
    } finally {
      await s.cleanup();
    }
  });
});
