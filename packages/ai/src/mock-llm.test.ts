import { z } from "zod";
import { describe, expect, it } from "vitest";
import { GENERATE_SYSTEM, buildGeneratePrompt, type GenerateRequest } from "./generate.js";
import { MOCK_LLM_ID, createMockLlm } from "./mock-llm.js";
import { createLlm } from "./providers.js";

const llm = createMockLlm();
const request = (extra: Partial<GenerateRequest> = {}): GenerateRequest => ({
  mode: "fill",
  note: { id: "produit/export", title: "CSV export", text: "---\ntype: functional-spec\nstatus: draft\nowner: ana\nacceptance_criteria: []\n---\n# CSV export\n" },
  original: { type: "functional-spec", status: "draft", owner: "ana" },
  template: "---\ntype: functional-spec\nstatus: draft\nowner: ana\nacceptance_criteria: []\n---\n\n# CSV export\n\n## Context\n<!-- ai: why now -->\n\n## Requirements\n\n## Acceptance criteria\n\n- [ ] \n",
  schema: { types: ["functional-spec"], statuses: ["draft"], linkTypes: ["related"] },
  linked: [],
  related: [{ id: "tech/sessions", title: "Sessions", excerpt: "Cookies expire." }],
  ...extra,
});

describe("mock llm", () => {
  it("is selected by name only, labelled, and has no tool-calling model", () => {
    const m = createLlm("mock");
    expect(m?.id).toBe(MOCK_LLM_ID);
    expect(m?.id).toBe("mock:demo");
    expect(m?.model).toBeUndefined();
    expect(createLlm(undefined)).toBeNull();
  });

  it("leaves diagrams and code out of an answer", async () => {
    const prompt = "Question: How does login work?\n\nSources:\n[1] auth\nLogin checks the password.\n\n```mermaid\nsequenceDiagram\nUser->>App: email\n```\n";
    const out = await llm.generate("Answer from the sources.", prompt);
    expect(out).toContain("Login checks the password");
    expect(out).not.toMatch(/sequenceDiagram|```/);
  });

  it("answers a question from the numbered sources, citing them", async () => {
    const prompt = "Question: How long is a reset link valid?\n\nSources:\n[1] Password reset > Password reset\n---\ntype: x\n---\n# Password reset\n\nA reset link is valid for one hour. It works once.\n\n[2] Sessions > Sessions\nSigned JWT cookies expire after fifteen minutes.";
    const a = await llm.generate("You answer questions about a team's specification notes.", prompt);
    expect(a).toBe("A reset link is valid for one hour [1]. Signed JWT cookies expire after fifteen minutes [2].");
    expect(await llm.generate("s", "Question: x\n\nSources:\n")).toBe("NO_SOURCE");
  });

  it("fills a template: keeps the frontmatter, writes every section, links grounded notes", async () => {
    const out = await llm.generate(GENERATE_SYSTEM, buildGeneratePrompt(request({ instruction: "Export the current table as a CSV file." })));
    expect(out.startsWith("---\ntype: functional-spec\nstatus: draft\nowner: ana\nacceptance_criteria: []\n---\n")).toBe(true);
    for (const h of ["## Context", "## Requirements", "## Acceptance criteria"]) expect(out).toContain(h);
    expect(out).toContain("export the current table as a CSV file");
    expect(out).toContain("[[tech/sessions|related]]");
    expect(out).not.toContain("ai:");
    expect(out).toMatch(/- \[ \] A user can complete/);
    expect(out).not.toMatch(/- \[ \]\s*$/m);
  });

  it("improves: tidies, keeps the text and adds acceptance criteria", async () => {
    const text = "---\ntype: functional-spec\nstatus: draft\nowner: ana\n---\n# CSV export   \n\n\n\nUsers export a table.   \n";
    const out = await llm.generate(GENERATE_SYSTEM, buildGeneratePrompt(request({ mode: "improve", note: { id: "x", title: "CSV export", text }, template: null })));
    expect(out).toContain("Users export a table.\n");
    expect(out).not.toMatch(/\n{3}/);
    expect(out).toContain("## Acceptance criteria");
    expect(out).toContain("- [ ] A user can complete csv export end to end");
  });

  it("returns a valid plan and order for smart search, without inventing filters", async () => {
    const Plan = z.object({ queries: z.array(z.string()), filters: z.object({ type: z.string().optional(), status: z.string().optional(), tag: z.string().optional() }) });
    const plan = await llm.object?.("You turn a question into searches over a team's vault", "Question: How do users reset their password?\nTypes in this vault: adr", Plan);
    expect(plan?.filters).toEqual({});
    expect(plan?.queries.length).toBeGreaterThanOrEqual(1);
    expect(plan?.queries.length).toBeLessThanOrEqual(2);
    expect(plan?.queries[0]).toBe("users reset password");
    const order = await llm.object?.("You order search results by how well", "Question: q\n\nResults:\n1. A > x\n2. B > y\n3. C > z", z.object({ order: z.array(z.number()) }));
    expect(order).toEqual({ order: [1, 2, 3] });
  });

  it("is deterministic and says what it is when it cannot help", async () => {
    const p = buildGeneratePrompt(request());
    expect(await llm.generate(GENERATE_SYSTEM, p)).toBe(await llm.generate(GENERATE_SYSTEM, p));
    expect(await llm.generate("hello", "world")).toMatch(/demo model \(mock\)/);
  });
});
