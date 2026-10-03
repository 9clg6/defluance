import { describe, expect, it } from "vitest";
import { parseNote } from "./parse.js";
import { defaultSchema } from "./schema.js";
import { validateVault } from "./validate.js";
import { buildVault } from "./vault.js";

const note = (path: string, fm: string, body = "# T\n") => parseNote(path, `---\n${fm}\n---\n${body}`);
const ok = "type: note\nstatus: draft\nowner: ana";
const run = (...notes: ReturnType<typeof note>[]) => validateVault(buildVault("/v", notes), defaultSchema);
const rules = (d: ReturnType<typeof run>) => d.map((x) => `${x.severity}:${x.rule}`);

describe("validateVault", () => {
  it("accepts a valid linked pair", () => {
    expect(run(note("a.md", ok, "[[b]]"), note("b.md", ok))).toEqual([]);
  });

  it("flags missing base fields", () => {
    const d = run(note("a.md", "type: note", "[[a]]"));
    expect(d.filter((x) => x.rule === "missing-field").map((x) => x.message)).toEqual([
      'missing required field "status"',
      'missing required field "owner"',
    ]);
  });

  it("flags a note without type", () => {
    expect(rules(run(note("a.md", "status: draft\nowner: x")))).toContain("error:missing-field");
  });

  it("flags unknown type and invalid status", () => {
    const d = run(note("a.md", "type: memo\nstatus: wip\nowner: x"));
    expect(rules(d)).toEqual(expect.arrayContaining(["error:unknown-type", "error:invalid-status"]));
  });

  it("enforces type-specific fields", () => {
    const d = run(note("a.md", "type: functional-spec\nstatus: draft\nowner: x"));
    expect(d.find((x) => x.rule === "missing-field")?.message).toContain("acceptance_criteria");
  });

  it("flags tags that are not a string list", () => {
    expect(rules(run(note("a.md", `${ok}\ntags: foo`)))).toContain("error:invalid-tags");
  });

  it("flags broken links with file and line", () => {
    const [d] = run(note("a.md", ok, "# T\n\n[[ghost]]\n")).filter((x) => x.rule === "broken-link");
    expect(d).toMatchObject({ file: "a.md", line: 8, severity: "error" });
  });

  it("does not resolve GitHub links but does not break on them", () => {
    const d = run(note("a.md", ok, "[[gh:o/r#1|tracked_by]]"));
    expect(d).toEqual([]);
  });

  it("warns on orphans, only warns on body alias, errors on strict unknown type", () => {
    expect(rules(run(note("a.md", ok)))).toEqual(["warning:orphan"]);
    const body = run(note("a.md", ok, "[[b|click here]]"), note("b.md", ok));
    expect(rules(body)).toEqual(["warning:unknown-link-type"]);
    const strict = run(note("a.md", `${ok}\nlinks:\n  - { to: b, type: nope }`), note("b.md", ok));
    expect(rules(strict)).toEqual(["error:unknown-link-type"]);
  });

  it("warns on missing heading", () => {
    const d = run(note("a.md", ok, "[[b#Nope]]"), note("b.md", ok));
    expect(rules(d)).toEqual(["warning:broken-heading"]);
  });

  it("validates 1000 notes in well under 5s", () => {
    const notes = Array.from({ length: 1000 }, (_, i) => note(`n${i}.md`, ok, `[[n${(i + 1) % 1000}]]`));
    const t = performance.now();
    expect(run(...notes)).toEqual([]);
    expect(performance.now() - t).toBeLessThan(5000);
  });
});
