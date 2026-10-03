import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeServer, type TestServer } from "./test-env.js";

let s: TestServer;
beforeAll(async () => {
  s = await makeServer();
});
afterAll(() => s.cleanup());

const RFC = "---\ntype: {{type}}\nstatus: draft\nowner: {{owner}}\n---\n\n# {{title}}\n\n## Summary\n<!-- ai: two sentences, no jargon -->\n\n## Plan\n";
const put = (name: string, content: string, token?: string) => s.call("PUT", `/api/v1/templates/${name}`, { body: { content }, ...(token ? { token } : {}) });
const list = async (token?: string) => ((await s.call("GET", "/api/v1/templates", token ? { token } : {})).body.items as { name: string; source: string; content: string }[]);

describe("templates", () => {
  it("lists the built-in templates for any reader", async () => {
    const reader = await s.token(["read"]);
    const items = await list(reader);
    expect(items.map((t) => t.name)).toEqual(expect.arrayContaining(["adr", "functional-spec", "note", "technical-spec"]));
    expect(items.every((t) => t.source === "builtin" && t.content.includes("{{title}}"))).toBe(true);
    expect((await s.call("GET", "/api/v1/templates", { token: null })).status).toBe(401);
  });

  it("creates a vault template in one commit, audits it, and builds notes from it without the hints", async () => {
    const r = await put("rfc", RFC);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: "rfc" });
    expect(r.body.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(s.git("log", "-1", "--format=%an|%s")).toBe("admin|template: rfc\n");
    expect(await readFile(join(s.root, ".defluance/templates/rfc.md"), "utf8")).toBe(RFC);
    expect((await list()).find((t) => t.name === "rfc")).toMatchObject({ source: "vault", content: RFC });
    expect((await s.call("GET", "/api/v1/audit?action=template.put")).body[0]).toMatchObject({ target: "rfc" });

    // the schema does not know the type "rfc", so build it from a type that does, with the same hinted file
    await put("adr", RFC);
    const made = await s.call("POST", "/api/v1/notes", { body: { type: "adr", title: "Use queues", id: "tech/use-queues" } });
    expect(made.status).toBe(201);
    const text = await readFile(join(s.root, "tech/use-queues.md"), "utf8");
    expect(text).toContain("## Summary");
    expect(text).not.toContain("ai:");
    await s.call("DELETE", "/api/v1/templates/adr");
    await s.call("DELETE", "/api/v1/templates/rfc");
  });

  it("an override replaces the built-in, and deleting it brings the built-in back", async () => {
    await put("glossary", RFC);
    expect((await list()).find((t) => t.name === "glossary")).toMatchObject({ source: "override", content: RFC });
    const del = await s.call("DELETE", "/api/v1/templates/glossary");
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ name: "glossary" });
    expect(s.git("log", "-1", "--format=%s")).toBe("template: glossary\n");
    expect((await list()).find((t) => t.name === "glossary")).toMatchObject({ source: "builtin" });
    expect((await s.call("DELETE", "/api/v1/templates/glossary")).status).toBe(404);
    expect((await s.call("DELETE", "/api/v1/templates/never-existed")).status).toBe(404);
  });

  it("saving the same text twice is not an error", async () => {
    const a = await put("same", RFC);
    const b = await put("same", RFC);
    expect(b.status).toBe(200);
    expect(b.body.commit).toBe(a.body.commit);
    await s.call("DELETE", "/api/v1/templates/same");
  });

  it("validates the name, the size and that the template produces a note", async () => {
    for (const bad of ["Upper", "1abc", "has_underscore", "a".repeat(42), "x.y"]) expect((await put(bad, RFC)).status, bad).toBe(422);
    expect((await put("big", `${RFC}${"x".repeat(21 * 1024)}`)).status).toBe(413);
    const noFm = await put("plain", "# {{title}}\n");
    expect(noFm.status).toBe(422);
    expect(noFm.body.title).toMatch(/must set type, status, owner/);
    expect((await put("broken", "---\nkey: [unclosed\n---\n# {{title}}")).status).toBe(422);
    expect((await put("partial", "---\ntype: {{type}}\nstatus: draft\n---\n# {{title}}")).body.title).toMatch(/must set owner/);
    expect((await s.call("PUT", "/api/v1/templates/rfc", { body: {} })).status).toBe(422);
    expect(s.git("status", "--porcelain", "--", ".defluance/templates").trim()).toBe("");
  });

  it("is for admins only, and never for agents", async () => {
    const editor = await s.token(["read", "write"], ["produit"]);
    const spaceAdmin = await s.token(["read", "write", "admin"], ["produit"]);
    const agent = await s.token(["read", "write"]);
    for (const token of [editor, spaceAdmin, agent]) {
      expect((await put("rfc", RFC, token)).status).toBe(403);
      expect((await s.call("DELETE", "/api/v1/templates/note", { token })).status).toBe(403);
    }
    expect((await s.call("PUT", "/api/v1/templates/rfc", { token: null, body: { content: RFC } })).status).toBe(401);
    expect((await list(agent)).length).toBeGreaterThan(0); // reading is open
    expect(s.git("status", "--porcelain", "--", ".defluance/templates").trim()).toBe("");
  });

  it("documents the endpoints in the OpenAPI document", async () => {
    const spec = (await s.call("GET", "/api/v1/openapi.json", { token: null })).body;
    expect(Object.keys(spec.paths["/api/v1/templates/{name}"])).toEqual(expect.arrayContaining(["put", "delete"]));
    expect(spec.paths["/api/v1/templates"].get).toBeDefined();
    expect(spec.paths["/api/v1/notes/{id}/generate"].post).toBeDefined();
  });
});
