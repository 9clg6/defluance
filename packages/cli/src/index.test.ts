import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./index.js";

let dir: string;
let out: string[];
const io = () => ({ out: (l: string) => out.push(l), err: (l: string) => out.push(`ERR ${l}`) });
const cli = (...args: string[]) => run(args, io());

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dfl-cli-"));
  out = [];
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("defluance init / new / validate", () => {
  it("init creates schema, 6 templates and a git repo, and is idempotent", async () => {
    expect(await cli("init", dir)).toBe(0);
    expect(await readFile(join(dir, ".defluance/schema.yaml"), "utf8")).toContain("functional-spec");
    expect(out.filter((l) => l.includes("templates/"))).toHaveLength(6);
    expect(out).toContain("create  .git");
    out = [];
    await cli("init", dir);
    expect(out.every((l) => l.startsWith("skip"))).toBe(true);
  });

  it("new creates a note from the template, and validate accepts it", async () => {
    await cli("init", dir);
    expect(await cli("new", "functional-spec", "Spec d'authentification", "--vault", dir, "--dir", "specs", "--owner", "ana")).toBe(0);
    const text = await readFile(join(dir, "specs/spec-d-authentification.md"), "utf8");
    expect(text).toContain("type: functional-spec");
    expect(text).toContain("owner: ana");
    expect(text).toContain("# Spec d'authentification");
    out = [];
    expect(await cli("validate", dir)).toBe(0);
    expect(out.at(-1)).toBe("1 notes, 0 errors, 1 warnings"); // orphan
  });

  it("new refuses to overwrite and to leave the vault", async () => {
    await cli("init", dir);
    await cli("new", "note", "Hello", "--vault", dir, "--owner", "a");
    expect(await cli("new", "note", "Hello", "--vault", dir, "--owner", "a")).toBe(1);
    expect(await cli("new", "note", "Evil", "--vault", dir, "--dir", "../out", "--owner", "a")).toBe(2);
    expect(await cli("new", "bogus", "X", "--vault", dir, "--owner", "a")).toBe(1);
  });

  it("validate exits 1 with file:line and rule on errors", async () => {
    await writeFile(join(dir, "bad.md"), "---\ntype: note\n---\n# Bad\n\n[[ghost]]\n");
    out = [];
    expect(await cli("validate", dir)).toBe(1);
    expect(out.some((l) => l.startsWith("bad.md:6") && l.includes("broken-link"))).toBe(true);
    expect(out.some((l) => l.includes("missing-field") && l.includes('"status"'))).toBe(true);
  });

  it("honours a custom schema.yaml", async () => {
    await cli("init", dir);
    await writeFile(join(dir, ".defluance/schema.yaml"), "types:\n  rfc:\n    required: []\nstatuses: [open, closed]\n");
    await writeFile(join(dir, "a.md"), "---\ntype: rfc\nstatus: open\nowner: x\n---\n# A\n[[a]]\n");
    expect(await cli("validate", dir)).toBe(0);
  });

  it("unknown command and no command exit 2", async () => {
    expect(await cli("frobnicate")).toBe(2);
    expect(await cli()).toBe(2);
    expect(await cli("--help")).toBe(0);
  });
});
