import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { GENERATE_SYSTEM, GenerateError, buildGeneratePrompt, generateNote, type GenerateEnv, type GenerateRequest, type ParsedLike } from "./generate.js";
import type { Llm } from "./providers.js";

const NOTES = new Set(["tech/sessions", "produit/password-reset"]);

/** A tiny stand-in for parseNote: frontmatter through YAML, wikilinks by regex. */
const parse = (text: string): ParsedLike => {
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  let frontmatter: Record<string, unknown> = {};
  let frontmatterError: string | undefined;
  try {
    frontmatter = (m ? parseYaml(m[1] ?? "") : {}) ?? {};
  } catch (e) {
    frontmatterError = (e as Error).message.split("\n")[0];
  }
  const links: ParsedLike["links"] = [];
  const add = (inner: string) => {
    const [left = "", alias] = inner.split("|");
    const target = left.startsWith("gh:") ? left : (left.split("#")[0] ?? "").trim();
    if (target) links.push({ target, kind: left.startsWith("gh:") ? "github" : "note", type: alias?.trim() || "related" });
  };
  for (const l of (frontmatter["links"] as unknown[] | undefined) ?? []) add(typeof l === "string" ? l.replace(/^\[\[|\]\]$/g, "") : `${(l as { to: string }).to}|${(l as { type: string }).type}`);
  for (const w of text.slice(m?.[0].length ?? 0).matchAll(/\[\[([^[\]\n]+?)\]\]/g)) add(w[1] ?? "");
  return { frontmatter, ...(frontmatterError ? { frontmatterError } : {}), links };
};
const env: GenerateEnv = { parse, resolve: ({ target, kind }) => (kind === "github" ? (target === "gh:acme/app#12" ? target : null) : NOTES.has(target) ? target : null) };

const request = (extra: Partial<GenerateRequest> = {}): GenerateRequest => ({
  mode: "fill",
  note: { id: "produit/auth-login", title: "Login", text: "---\ntype: functional-spec\nstatus: draft\nowner: ana\n---\n# Login\n\n## Context\n" },
  original: { type: "functional-spec", status: "draft", owner: "ana" },
  template: "---\ntype: functional-spec\nstatus: draft\nowner: ana\n---\n# Login\n\n## Context\n<!-- ai: why now -->\n",
  schema: { types: ["functional-spec"], statuses: ["draft", "approved"], linkTypes: ["depends_on", "related"] },
  linked: [],
  related: [{ id: "tech/sessions", title: "Sessions", excerpt: "Cookies expire after fifteen minutes." }],
  ...extra,
});

const scripted = (...replies: (string | Error)[]): Llm & { prompts: string[] } => {
  const prompts: string[] = [];
  let i = 0;
  return {
    id: "fake",
    prompts,
    generate: async (_s, p) => {
      prompts.push(p);
      const r = replies[Math.min(i++, replies.length - 1)] as string | Error;
      if (r instanceof Error) throw r;
      return r;
    },
  };
};
const note = (fm: string, body = "# Login\n\nText.") => `---\n${fm}\n---\n${body}\n`;

describe("buildGeneratePrompt", () => {
  it("carries the template with its hints, the note, and the context notes", () => {
    const p = buildGeneratePrompt(request({ instruction: "focus on lockout" }));
    expect(p).toContain("Task: fill");
    expect(p).toContain("focus on lockout");
    expect(p).toContain("<!-- ai: why now -->");
    expect(p).toContain('<related id="tech/sessions" title="Sessions">');
    expect(GENERATE_SYSTEM).toMatch(/Never change status/);
    expect(buildGeneratePrompt(request({ mode: "improve" }))).toContain("testable");
  });
});

describe("generateNote", () => {
  it("forces type, status and owner back to the original and says so", async () => {
    const llm = scripted(note("type: adr\nstatus: approved\nowner: mallory\ntags: [auth]"));
    const r = await generateNote(llm, request(), env);
    const fm = parse(r.content).frontmatter;
    expect(fm).toMatchObject({ type: "functional-spec", status: "draft", owner: "ana", tags: ["auth"] });
    expect(r.warnings.join("\n")).toMatch(/status was changed to "approved": restored to "draft"/);
    expect(r.warnings.join("\n")).toMatch(/"owner" was changed/);
  });

  it("restores a missing field, and removes one the original never had", async () => {
    const a = await generateNote(scripted(note("type: functional-spec")), request(), env);
    expect(parse(a.content).frontmatter).toMatchObject({ status: "draft", owner: "ana" });
    const b = await generateNote(scripted(note("type: note\nstatus: approved\nowner: x")), request({ original: { type: "note", status: null, owner: "x" } }), env);
    expect(parse(b.content).frontmatter["status"]).toBeUndefined();
  });

  it("strips a code fence around the whole output, and only that", async () => {
    const r = await generateNote(scripted("```markdown\n" + note("type: functional-spec\nstatus: draft\nowner: ana", "# Login\n\n```js\nx()\n```") + "```"), request(), env);
    expect(r.content.startsWith("---\n")).toBe(true);
    expect(r.content).toContain("```js\nx()\n```");
    expect(r.content).not.toMatch(/^```markdown/);
  });

  it("drops body and frontmatter links to notes that do not exist, and reports them", async () => {
    const text = note(
      'type: functional-spec\nstatus: draft\nowner: ana\nlinks:\n  - "[[tech/sessions|depends_on]]"\n  - "[[ghost/one|depends_on]]"\n  - { to: ghost/two, type: blocks }',
      "# Login\n\nSee [[tech/sessions|depends_on]], [[ghost/three|related]] and [[gh:acme/app#12|tracked_by]] and [[gh:acme/app#99|tracked_by]].",
    );
    const r = await generateNote(scripted(text), request(), env);
    expect(r.content).not.toMatch(/ghost\/one|ghost\/two|\[\[ghost/);
    expect(r.content).toContain("ghost/three"); // kept as plain text
    expect(r.content).not.toContain("gh:acme/app#99]]");
    expect(r.warnings).toEqual(expect.arrayContaining(['removed a link to "ghost/one": no such note', 'removed a link to "ghost/two": no such note', 'removed a link to "ghost/three": no such note']));
    expect(r.links).toEqual([
      { to: "tech/sessions", type: "depends_on" },
      { to: "gh:acme/app#12", type: "tracked_by" },
    ]);
  });

  it("drops the whole links key when nothing resolves", async () => {
    const r = await generateNote(scripted(note('type: functional-spec\nstatus: draft\nowner: ana\nlinks:\n  - "[[ghost|related]]"')), request(), env);
    expect(parse(r.content).frontmatter["links"]).toBeUndefined();
  });

  it("retries once when the output does not parse, with the reason", async () => {
    const llm = scripted("Sure! Here is your note: no frontmatter", note("type: functional-spec\nstatus: draft\nowner: ana"));
    const r = await generateNote(llm, request(), env);
    expect(llm.prompts).toHaveLength(2);
    expect(llm.prompts[1]).toMatch(/previous answer was rejected: the note has no YAML frontmatter/);
    expect(r.content).toContain("# Login");
  });

  it("rejects invalid YAML frontmatter, and gives up after the retry", async () => {
    const llm = scripted("---\nkey: [unclosed\n---\n# x");
    await expect(generateNote(llm, request(), env)).rejects.toBeInstanceOf(GenerateError);
    expect(llm.prompts).toHaveLength(2);
  });

  it("does not retry when the model itself fails", async () => {
    const llm = scripted(new Error("rate limited"));
    await expect(generateNote(llm, request(), env)).rejects.toThrow("rate limited");
    expect(llm.prompts).toHaveLength(1);
  });
});
