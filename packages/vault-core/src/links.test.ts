import { describe, expect, it } from "vitest";
import { frontmatterLines, retargetLinks } from "./links.js";

describe("retargetLinks", () => {
  it("keeps the heading and the alias or type, changes only the target", () => {
    const t = "See [[old]], [[old#Flow]], [[old|depends_on]] and [[old#Flow|the flow]]. Not [[older]] or [[x/old]].";
    expect(retargetLinks(t, "old", "new/place")).toBe("See [[new/place]], [[new/place#Flow]], [[new/place|depends_on]] and [[new/place#Flow|the flow]]. Not [[older]] or [[x/old]].");
  });

  it("only touches the lines it is given, so code that looks like a link stays as it is", () => {
    const t = "[[old]]\n```\n[[old]]\n```\n[[old]]";
    expect(retargetLinks(t, "old", "new", new Set([1, 5]))).toBe("[[new]]\n```\n[[old]]\n```\n[[new]]");
  });

  it("knows where the frontmatter is", () => {
    expect([...frontmatterLines("---\na: 1\nlinks:\n  - x\n---\nbody\n")]).toEqual([2, 3, 4]);
    expect(frontmatterLines("no frontmatter").size).toBe(0);
  });
});
