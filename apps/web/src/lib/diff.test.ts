import { describe, expect, it } from "vitest";
import { sideBySide } from "./diff";

const PATCH = `diff --git a/a.md b/a.md
index 1..2 100644
--- a/a.md
+++ b/a.md
@@ -1,4 +1,4 @@
 # Title
-old line
+new line
 same
-removed
@@ -10,2 +10,3 @@ ctx
 ten
+added
 end
\\ No newline at end of file`;

describe("sideBySide", () => {
  const rows = sideBySide(PATCH);
  it("skips file headers and numbers both sides", () => {
    expect(rows[0]).toMatchObject({ kind: "hunk" });
    expect(rows[1]).toMatchObject({ kind: "context", left: { n: 1, text: "# Title" }, right: { n: 1, text: "# Title" } });
  });
  it("pairs a deletion with the addition that follows as one changed row", () => {
    expect(rows[2]).toMatchObject({ kind: "change", left: { n: 2, text: "old line" }, right: { n: 2, text: "new line" } });
  });
  it("shows unpaired deletions and additions on one side", () => {
    expect(rows[4]).toMatchObject({ kind: "del", left: { n: 4, text: "removed" }, right: null });
    expect(rows.find((r) => r.kind === "add")).toMatchObject({ kind: "add", left: null, right: { n: 11, text: "added" } });
  });
  it("restarts line numbers at every hunk and ignores the no-newline marker", () => {
    const second = rows.filter((r) => r.kind === "hunk")[1];
    expect(second?.hunk).toContain("@@ -10,2 +10,3 @@");
    expect(rows.at(-1)).toMatchObject({ kind: "context", left: { n: 11, text: "end" }, right: { n: 12, text: "end" } });
    expect(sideBySide("")).toEqual([]);
  });
});
