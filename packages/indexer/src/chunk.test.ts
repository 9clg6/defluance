import { describe, expect, it } from "vitest";
import { chunkBody } from "./chunk.js";

describe("chunkBody", () => {
  it("splits by heading and keeps the heading path", () => {
    const c = chunkBody("intro\n\n# A\n\ntext a\n\n## B\n\ntext b\n", "Title");
    expect(c.map((x) => [x.heading, x.content])).toEqual([
      ["Title", "intro"],
      ["A", "text a"],
      ["A > B", "text b"],
    ]);
  });

  it("ignores headings inside code fences", () => {
    const c = chunkBody("# A\n\n```\n# not a heading\n```\n", "T");
    expect(c).toHaveLength(1);
    expect(c[0]?.content).toContain("# not a heading");
  });

  it("keeps link words, drops the syntax", () => {
    expect(chunkBody("see [[auth-login|implements]] and [[Home#Intro]]", "T")[0]?.content).toBe("see implements and Home");
  });

  it("splits long sections with overlap and bounded size", () => {
    const para = (n: number) => `${"word ".repeat(150)}end${n}`;
    const body = Array.from({ length: 12 }, (_, i) => para(i)).join("\n\n");
    const chunks = chunkBody(body, "T");
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(3300);
    expect(chunks.map((c) => c.content).join(" ")).toContain("end11");
  });

  it("hashes depend on heading and content", () => {
    const a = chunkBody("# A\n\nx", "T")[0];
    const b = chunkBody("# B\n\nx", "T")[0];
    expect(a?.hash).not.toBe(b?.hash);
    expect(chunkBody("", "T")).toEqual([]);
  });
});
