import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { chunkBody, sha256 } from "./chunk.js";

const word = fc.stringMatching(/^w[a-z0-9]{2,8}$/);
const paragraph = fc.array(word, { minLength: 1, maxLength: 120 }).map((w) => w.join(" "));
const heading = fc.tuple(fc.integer({ min: 1, max: 4 }), word).map(([d, w]) => `${"#".repeat(d)} ${w}`);
const fence = word.map((w) => `\`\`\`\n# hidden${w}\ncode ${w}\n\`\`\``);
const block = fc.oneof({ weight: 4, arbitrary: paragraph }, { weight: 2, arbitrary: heading }, { weight: 1, arbitrary: fence });
const body = fc.array(block, { maxLength: 25 }).map((b) => b.join("\n\n"));
/** A body with a paragraph far over the chunk size, to exercise splitting. */
const huge = fc.array(word, { minLength: 900, maxLength: 1600 }).map((w) => w.join(" "));

describe("chunkBody properties", () => {
  it("never throws, numbers chunks in order, and keeps each under the size limit", () => {
    fc.assert(
      fc.property(fc.oneof(body, huge), (b) => {
        const chunks = chunkBody(b, "Title");
        chunks.forEach((c, i) => {
          expect(c.ordinal).toBe(i);
          expect(c.content.length).toBeGreaterThan(0);
          expect(c.content.length).toBeLessThanOrEqual(3200);
        });
      }),
      { numRuns: 200 },
    );
  });

  it("loses no word: everything written is findable in some chunk or heading", () => {
    fc.assert(
      fc.property(fc.oneof(body, huge), (b) => {
        const all = chunkBody(b, "Title").map((c) => `${c.heading} ${c.content}`).join(" ");
        const seen = new Set(all.split(/\W+/));
        for (const w of b.split(/\W+/)) if (w) expect(seen.has(w), `lost "${w}"`).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("never mistakes a line inside a code fence for a heading", () => {
    fc.assert(
      fc.property(body, (b) => {
        for (const c of chunkBody(b, "Title")) expect(c.heading).not.toContain("hidden");
      }),
      { numRuns: 200 },
    );
  });

  it("is deterministic, and the hash follows the heading and the content", () => {
    fc.assert(
      fc.property(body, (b) => {
        const a = chunkBody(b, "Title");
        expect(chunkBody(b, "Title")).toEqual(a);
        for (const c of a) expect(c.hash).toBe(sha256(`${c.heading}\n${c.content}`));
      }),
      { numRuns: 100 },
    );
  });
});
