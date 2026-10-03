import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { globMatch } from "./services/impact.js";

const seg = fc.stringMatching(/^[a-z][a-z0-9_.()-]{0,8}$/);
const path = fc.array(seg, { minLength: 1, maxLength: 5 }).map((s) => s.join("/"));

describe("globMatch properties", () => {
  it("a path pattern matches itself and what is inside it, never a sibling that shares the spelling", () => {
    fc.assert(
      fc.property(path, seg, (p, extra) => {
        expect(globMatch(p, p)).toBe(true);
        expect(globMatch(p, `${p}/${extra}`)).toBe(true);
        expect(globMatch(p, `${p}${extra}`)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("`*` stands for exactly one folder level and `**` for any depth", () => {
    fc.assert(
      fc.property(fc.array(seg, { minLength: 2, maxLength: 5 }), fc.nat(), (segs, n) => {
        const at = n % segs.length;
        const file = segs.join("/");
        const star = segs.map((s, i) => (i === at ? "*" : s)).join("/");
        expect(globMatch(star, file)).toBe(true);
        expect(globMatch(`${segs[0]}/**`, file)).toBe(true);
        expect(globMatch(star, `${file}/deeper`)).toBe(false);
        expect(globMatch(star, segs.filter((_, i) => i !== at).join("/"))).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("characters that mean something in a regular expression are literal in a glob", () => {
    fc.assert(
      fc.property(seg, seg, (a, b) => {
        fc.pre(a.includes(".") || a.includes("(") || a.includes(")"));
        const mutated = a.replace(/[.()]/g, "X");
        fc.pre(mutated !== a);
        expect(globMatch(`${a}/*`, `${a}/${b}`)).toBe(true);
        expect(globMatch(`${a}/*`, `${mutated}/${b}`)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});
