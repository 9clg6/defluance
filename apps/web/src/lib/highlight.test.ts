import { describe, expect, it } from "vitest";
import { fold, highlight, queryTerms } from "./highlight";

describe("queryTerms", () => {
  it("drops stop words in both languages, accents and duplicates", () => {
    expect(queryTerms("How does the Réinitialisation work? reset reset")).toEqual(["reinitialisation", "work", "reset"]);
    expect(queryTerms("what is it")).toEqual(["what", "is", "it"]);
    expect(queryTerms("")).toEqual([]);
  });
});

describe("fold", () => {
  it("keeps the length so positions match the original", () => {
    for (const s of ["Réinitialisation", "Ça va très bien", "naïve café"]) expect(fold(s)).toHaveLength(s.length);
    expect(fold("Éléphant")).toBe("elephant");
  });
});

describe("highlight", () => {
  const join = (segs: { text: string; hit: boolean }[]) => segs.map((s) => (s.hit ? `[${s.text}]` : s.text)).join("");
  it("marks whole words that start with a term, ignoring case and accents", () => {
    expect(join(highlight("Password resets are Réinitialisation links", ["reset", "reinitialisation"]))).toBe("Password [resets] are [Réinitialisation] links");
  });
  it("does not mark inside a word", () => {
    expect(join(highlight("unreset preset reset", ["reset"]))).toBe("unreset preset [reset]");
  });
  it("round-trips the text and survives special characters in terms", () => {
    const text = "Cost is $5 (about) a+b";
    expect(highlight(text, ["a+b", "(about"]).map((s) => s.text).join("")).toBe(text);
    expect(highlight("plain", [])).toEqual([{ text: "plain", hit: false }]);
  });
});
