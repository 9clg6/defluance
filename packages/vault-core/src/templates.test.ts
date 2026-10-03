import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TEMPLATE_DIR, defaultTemplates, listTemplates, renderTemplate, renderTemplateString, stripAiHints } from "./templates.js";

const vars = { type: "adr", title: "Use Postgres", owner: "ana" };
const dirs: string[] = [];
const vault = async (files: Record<string, string> = {}) => {
  const root = await mkdtemp(join(tmpdir(), "dfl-tpl-"));
  dirs.push(root);
  await mkdir(join(root, TEMPLATE_DIR), { recursive: true });
  for (const [n, c] of Object.entries(files)) await writeFile(join(root, TEMPLATE_DIR, `${n}.md`), c);
  return root;
};
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("stripAiHints", () => {
  it("removes a hint with the line it sits on", () => {
    expect(stripAiHints("## Context\n<!-- ai: say why now -->\n\n## Design\n")).toBe("## Context\n\n## Design\n");
  });
  it("removes a hint that shares a line with a heading, and a multi-line one", () => {
    expect(stripAiHints("## Design <!-- ai: diagrams welcome -->\ntext\n<!-- ai: first\nsecond -->\n## End\n")).toBe("text\n## End\n");
  });
  it("leaves other HTML comments alone", () => {
    expect(stripAiHints("<!-- keep me -->\n## A\n")).toBe("<!-- keep me -->\n## A\n");
  });
  it("handles a hint on the last line without newline and CRLF", () => {
    expect(stripAiHints("## A\r\n<!-- ai: x -->\r\n## B\r\n<!-- ai: y -->")).toBe("## A\r\n## B\r\n");
  });
});

describe("renderTemplate", () => {
  it("fills the variables and strips hints by default", async () => {
    const root = await vault({ adr: "---\ntype: {{type}}\nstatus: draft\nowner: {{owner}}\n---\n\n# {{title}}\n\n## Decision\n<!-- ai: one sentence -->\n" });
    const out = await renderTemplate(root, vars);
    expect(out).toContain("# Use Postgres");
    expect(out).not.toContain("ai:");
    expect(await renderTemplate(root, vars, { hints: true })).toContain("<!-- ai: one sentence -->");
  });
  it("falls back to the built-in and rejects an unknown type", async () => {
    const root = await vault();
    expect(await renderTemplate(root, vars)).toBe(renderTemplateString(defaultTemplates["adr"] as string, vars));
    await expect(renderTemplate(root, { ...vars, type: "nope" })).rejects.toThrow(/no template/);
  });
});

describe("listTemplates", () => {
  it("tells built-in, vault and override apart", async () => {
    const root = await vault({ adr: "---\ntype: {{type}}\nstatus: draft\nowner: {{owner}}\n---\n# {{title}}\n", rfc: "---\ntype: {{type}}\nstatus: draft\nowner: {{owner}}\n---\n# {{title}}\n", "Bad Name": "x" });
    const by = Object.fromEntries((await listTemplates(root)).map((t) => [t.name, t.source]));
    expect(by).toMatchObject({ adr: "override", rfc: "vault", note: "builtin", "functional-spec": "builtin" });
    expect(by["Bad Name"]).toBeUndefined();
  });
});
