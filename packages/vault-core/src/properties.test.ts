import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LINK_TYPES } from "@defluance/shared";
import { parse as parseYaml } from "yaml";
import { addFrontmatterLink, setFrontmatterField } from "./frontmatter.js";
import { parseNote } from "./parse.js";

const BASE = `---\ntype: note\nstatus: draft\nowner: ana\n# keep this comment\ntags: [a, b]\n---\n# Title\n\nBody.\n`;

const fm = (raw: string) => parseYaml(/^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? "") as Record<string, unknown>;

/** Text a person could put in a field: anything printable, quotes and colons included. */
/** Control characters and line separators YAML cannot carry in a plain field, so they are not part of the claim. */
const UNSAFE = new Set([...Array.from({ length: 32 }, (_, i) => i).filter((c) => c !== 9 && c !== 10), 0x7f, 0x85, 0x2028, 0x2029, 0xfeff]);
const text = fc.string({ unit: "grapheme", maxLength: 60 });
const value = fc.oneof(text, fc.array(text, { minLength: 2, maxLength: 4 }).map((l) => l.join("\n")), fc.string({ unit: "grapheme", minLength: 90, maxLength: 200 })).filter((s) => ![...s].some((c) => UNSAFE.has(c.codePointAt(0) as number)));
const key = fc.stringMatching(/^[a-z][a-z_]{0,12}$/);

describe("setFrontmatterField", () => {
  it("reads back exactly what was set, for any text", () => {
    fc.assert(
      fc.property(key, value, (k, v) => {
        fc.pre(!["type", "status", "owner", "tags"].includes(k));
        expect(fm(setFrontmatterField(BASE, k, v))[k]).toBe(v);
      }),
      { numRuns: 300 },
    );
  });

  it("changes only that field: the comment, the other fields and the body survive", () => {
    fc.assert(
      fc.property(value, (v) => {
        const out = setFrontmatterField(BASE, "status", v);
        expect(out).toContain("# keep this comment");
        expect(out.endsWith("---\n# Title\n\nBody.\n")).toBe(true);
        expect({ ...fm(out), status: null }).toEqual({ ...fm(BASE), status: null });
      }),
      { numRuns: 200 },
    );
  });

  it("is idempotent and keeps the line ending style", () => {
    fc.assert(
      fc.property(key, value, fc.boolean(), (k, v, crlf) => {
        fc.pre(!["type", "status", "owner", "tags"].includes(k));
        const raw = crlf ? BASE.replace(/\n/g, "\r\n") : BASE;
        const once = setFrontmatterField(raw, k, v);
        expect(setFrontmatterField(once, k, v)).toBe(once);
        expect(/\r\n/.test(once)).toBe(crlf);
      }),
      { numRuns: 200 },
    );
  });
});

const target = fc.stringMatching(/^[a-z][a-z0-9/-]{0,20}$/);
const linkType = fc.constantFrom(...LINK_TYPES);

describe("addFrontmatterLink", () => {
  it("adds a link the parser finds with the right target and type, once", () => {
    fc.assert(
      fc.property(target, linkType, (t, ty) => {
        const once = addFrontmatterLink(BASE, t, ty);
        expect(addFrontmatterLink(once, t, ty)).toBe(once);
        const links = parseNote("x.md", once).links.filter((l) => l.source === "frontmatter");
        expect(links.map((l) => [l.target, l.type])).toEqual([[t, ty]]);
      }),
      { numRuns: 200 },
    );
  });

  it("keeps earlier links when more are added", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.tuple(target, linkType), { minLength: 1, maxLength: 6, selector: ([t, ty]) => `${t}|${ty}` }), (pairs) => {
        let raw = BASE;
        for (const [t, ty] of pairs) raw = addFrontmatterLink(raw, t, ty);
        const found = parseNote("x.md", raw).links.filter((l) => l.source === "frontmatter").map((l) => `${l.target}|${l.type}`);
        expect(found.sort()).toEqual(pairs.map(([t, ty]) => `${t}|${ty}`).sort());
      }),
      { numRuns: 100 },
    );
  });
});

describe("parseNote", () => {
  it("never throws, whatever the file contains", () => {
    fc.assert(fc.property(fc.string({ unit: "binary", maxLength: 400 }), (raw) => void parseNote("fuzz.md", raw)), { numRuns: 500 });
    fc.assert(fc.property(fc.string({ unit: "grapheme", maxLength: 400 }).map((s) => `---\n${s}\n---\n${s}`), (raw) => void parseNote("fuzz.md", raw)), { numRuns: 300 });
  });

  it("finds every wikilink written in the body, with its type and line", () => {
    // Not starting with spaces: four of them make an indented code block, where links are rightly ignored.
    const prose = fc.stringMatching(/^([A-Za-z][A-Za-z ,.]{0,29})?$/);
    fc.assert(
      fc.property(fc.array(fc.tuple(prose, target, linkType), { minLength: 1, maxLength: 8 }), (items) => {
        const body = items.map(([p, t, ty]) => `${p} [[${t}|${ty}]] ${p}`).join("\n\n");
        const raw = `---\ntype: note\nstatus: draft\nowner: ana\n---\n${body}\n`;
        const links = parseNote("x.md", raw).links.filter((l) => l.source === "body");
        expect(links.map((l) => [l.target, l.type])).toEqual(items.map(([, t, ty]) => [t, ty]));
        const lines = links.map((l) => l.line);
        expect([...lines].sort((a, b) => a - b)).toEqual(lines);
      }),
      { numRuns: 200 },
    );
  });

  it("does not see links inside fenced code", () => {
    fc.assert(
      fc.property(target, linkType, (t, ty) => {
        const raw = `---\ntype: note\nstatus: draft\nowner: ana\n---\n\`\`\`\n[[${t}|${ty}]]\n\`\`\`\n`;
        expect(parseNote("x.md", raw).links).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
