import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { en, fr } from "./dict";
import { GENERATE_PRESETS, replaceYText, TEMPLATE_NAME, unifiedPatch } from "./generate";
import { sideBySide } from "./diff";
import { mcpSnippets } from "./mcp";

describe("unifiedPatch", () => {
  it("is empty for equal texts", () => expect(unifiedPatch("a\nb", "a\nb")).toBe(""));
  it("reads back through sideBySide as the changes between the texts", () => {
    const rows = sideBySide(unifiedPatch("# T\n\nold line\nsame", "# T\n\nnew line\nsame\nadded"));
    expect(rows.find((r) => r.kind === "change")).toMatchObject({ left: { n: 3, text: "old line" }, right: { n: 3, text: "new line" } });
    expect(rows.find((r) => r.kind === "add")?.right).toMatchObject({ n: 5, text: "added" });
  });
  it("keeps far apart changes in separate hunks", () => {
    const a = Array.from({ length: 30 }, (_, i) => `l${i}`);
    const b = [...a];
    b[1] = "x";
    b[28] = "y";
    expect(unifiedPatch(a.join("\n"), b.join("\n")).match(/^@@/gm)).toHaveLength(2);
  });
});

describe("replaceYText", () => {
  it("swaps the whole text in one change", () => {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, "old text");
    let updates = 0;
    doc.on("update", () => updates++);
    replaceYText(text, "new text");
    expect(text.toString()).toBe("new text");
    expect(updates).toBe(1);
  });
});

describe("helpers", () => {
  it("every preset has a label in both languages", () => {
    for (const p of GENERATE_PRESETS) {
      expect(en[`generate.preset.${p}`]).toBeTruthy();
      expect(fr[`generate.preset.${p}`]).toBeTruthy();
    }
  });
  it("validates template names", () => {
    expect(["adr", "functional-spec", "a1"].every((n) => TEMPLATE_NAME.test(n))).toBe(true);
    expect(["", "1a", "Adr", "a_b", "a".repeat(42)].some((n) => TEMPLATE_NAME.test(n))).toBe(false);
  });
  it("builds snippets with a placeholder token only", () => {
    const s = mcpSnippets("http://h/mcp");
    expect(s.claude).toBe('claude mcp add --transport http defluance http://h/mcp --header "Authorization: Bearer <YOUR_TOKEN>"');
    expect(JSON.parse(s.json).mcpServers.defluance).toEqual({ url: "http://h/mcp", headers: { Authorization: "Bearer <YOUR_TOKEN>" } });
    expect(s.stdio).toBe("claude mcp add defluance -- npx defluance mcp ./my-notes");
  });
});
