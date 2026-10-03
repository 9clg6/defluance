import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { parseNote } from "./parse.js";
import { addFrontmatterLink, setFrontmatterField } from "./frontmatter.js";

const doc = (fm: string, body = "# T\n\ntext\n") => `---\n${fm}\n---\n${body}`;

describe("setFrontmatterField", () => {
  it("replaces a value and leaves everything else byte for byte", () => {
    const raw = doc("# keep me\ntype: note   # inline\nstatus: draft\nowner: ana\ntags: [a, b]");
    expect(setFrontmatterField(raw, "status", "approved")).toBe(doc("# keep me\ntype: note   # inline\nstatus: approved\nowner: ana\ntags: [a, b]"));
  });
  it("appends a missing field and quotes when YAML needs it", () => {
    expect(setFrontmatterField(doc("type: note"), "owner", "ana")).toBe(doc("type: note\nowner: ana"));
    const out = setFrontmatterField(doc("type: note"), "owner", "a: b");
    expect(parseNote("n.md", out).frontmatter["owner"]).toBe("a: b");
  });
  it("does not touch a similarly named key and keeps CRLF", () => {
    const raw = "---\r\nstatus_note: x\r\nstatus: draft\r\n---\r\nbody";
    expect(setFrontmatterField(raw, "status", "review")).toBe("---\r\nstatus_note: x\r\nstatus: review\r\n---\r\nbody");
  });
  it("refuses notes without frontmatter", () => {
    expect(() => setFrontmatterField("# T", "status", "x")).toThrow(/no frontmatter/);
  });
});

describe("addFrontmatterLink", () => {
  const linksOf = (raw: string) => parseNote("n.md", raw).links.map((l) => `${l.target}|${l.type}`);
  it("creates the list", () => {
    const out = addFrontmatterLink(doc("type: note"), "auth", "implements");
    expect(linksOf(out)).toEqual(["auth|implements"]);
  });
  it("appends to a block list, before any following key", () => {
    const raw = doc('links:\n  - "[[a|related]]"\n  - "[[b|blocks]]"\nowner: ana');
    const out = addFrontmatterLink(raw, "c", "depends_on");
    expect(out).toBe(doc('links:\n  - "[[a|related]]"\n  - "[[b|blocks]]"\n  - "[[c|depends_on]]"\nowner: ana'));
    expect(linksOf(out)).toEqual(["a|related", "b|blocks", "c|depends_on"]);
  });
  it("handles an empty inline list and is idempotent", () => {
    const out = addFrontmatterLink(doc("links: []"), "a", "related");
    expect(linksOf(out)).toEqual(["a|related"]);
    expect(addFrontmatterLink(out, "a", "related")).toBe(out);
  });
  it("keeps GitHub keys intact", () => {
    const out = addFrontmatterLink(doc("type: note"), "gh:acme/app#12", "tracked_by");
    const [l] = parseNote("n.md", out).links;
    expect(l).toMatchObject({ kind: "github", target: "gh:acme/app#12", type: "tracked_by" });
  });
  it("refuses an inline list it cannot edit safely", () => {
    expect(() => addFrontmatterLink(doc('links: ["[[a]]"]'), "b", "related")).toThrow(/unsupported/);
  });
});

describe("setFrontmatterField with awkward values (found by property tests)", () => {
  const raw = "---\ntype: note\nstatus: draft\nowner: ana\n---\n# T\n";
  const read = (r: string) => parseYaml(/^---\n([\s\S]*?)\n---/.exec(r)?.[1] ?? "") as Record<string, unknown>;

  it("keeps a multi-line value valid instead of corrupting the note", () => {
    expect(read(setFrontmatterField(raw, "summary", "first line\nsecond line"))["summary"]).toBe("first line\nsecond line");
  });

  it("keeps a long value valid instead of letting the library fold it across unindented lines", () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const out = setFrontmatterField(raw, "title", long);
    expect(read(out)["title"]).toBe(long);
    expect(out).toContain(`title: ${long}`);
  });

  it("does not lose a value made of a no-break space", () => {
    expect(read(setFrontmatterField(raw, "note", " "))["note"]).toBe(" ");
  });

  it("still writes plain scalars plainly", () => {
    expect(setFrontmatterField(raw, "status", "approved")).toContain("\nstatus: approved\n");
  });
});
