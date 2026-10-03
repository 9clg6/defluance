import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sideBySide } from "./diff";

const text = fc.stringMatching(/^[A-Za-z0-9 ,.]{0,24}$/);
const op = fc.tuple(fc.constantFrom(" ", "-", "+"), text);

/** A one-file unified diff with a few hunks, built from random operations. */
const patch = fc.array(fc.array(op, { minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 4 }).map((hunks) => {
  let l = 1;
  let r = 1;
  const out = ["diff --git a/x.md b/x.md", "--- a/x.md", "+++ b/x.md"];
  const expected: { left: number[]; right: number[] } = { left: [], right: [] };
  for (const h of hunks) {
    const dl = h.filter(([k]) => k !== "+").length;
    const dr = h.filter(([k]) => k !== "-").length;
    out.push(`@@ -${l},${dl} +${r},${dr} @@`);
    for (const [k, t] of h) {
      out.push(`${k}${t}`);
      if (k !== "+") expected.left.push(l++);
      if (k !== "-") expected.right.push(r++);
    }
    l += 3; // unchanged lines between hunks
    r += 3;
  }
  return { patch: out.join("\n"), expected };
});

describe("sideBySide properties", () => {
  it("numbers every old line and every new line exactly once, in order", () => {
    fc.assert(
      fc.property(patch, ({ patch: p, expected }) => {
        const rows = sideBySide(p);
        expect(rows.flatMap((r) => (r.left ? [r.left.n] : []))).toEqual(expected.left);
        expect(rows.flatMap((r) => (r.right ? [r.right.n] : []))).toEqual(expected.right);
      }),
      { numRuns: 300 },
    );
  });

  it("shows context on both sides, a lone deletion or addition on one side, and pairs the rest as changes", () => {
    fc.assert(
      fc.property(patch, ({ patch: p }) => {
        for (const r of sideBySide(p)) {
          if (r.kind === "context") expect(r.left?.text).toBe(r.right?.text);
          if (r.kind === "del") expect([!!r.left, !!r.right]).toEqual([true, false]);
          if (r.kind === "add") expect([!!r.left, !!r.right]).toEqual([false, true]);
          if (r.kind === "change") expect([!!r.left, !!r.right]).toEqual([true, true]);
          if (r.kind === "hunk") expect(r.hunk).toMatch(/^@@ /);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("never throws on arbitrary text", () => {
    fc.assert(fc.property(fc.string({ unit: "binary", maxLength: 500 }), (s) => void sideBySide(s)), { numRuns: 300 });
  });
});
