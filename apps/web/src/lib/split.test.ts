import { describe, expect, it } from "vitest";
import { clampSplit, parseSide, parseSplit, splitForKey } from "./split";

describe("split", () => {
  it("keeps 25% for each side", () => {
    expect(clampSplit(10)).toBe(25);
    expect(clampSplit(90)).toBe(75);
    expect(clampSplit(40)).toBe(40);
    expect(clampSplit(Number.NaN)).toBe(50);
  });

  it("reads the stored width, with 50 for anything odd", () => {
    expect(parseSplit("62.5")).toBe(62.5);
    expect(parseSplit("5")).toBe(25);
    expect(parseSplit("abc")).toBe(50);
    expect(parseSplit("")).toBe(50);
    expect(parseSplit(null)).toBe(50);
  });

  it("reads the stored Preview choice: unset stays undefined", () => {
    expect(parseSide("on")).toBe(true);
    expect(parseSide("off")).toBe(false);
    expect(parseSide("yes")).toBeUndefined();
    expect(parseSide(null)).toBeUndefined();
  });

  it("moves by 2% with the arrows, to the ends with Home and End", () => {
    expect(splitForKey("ArrowLeft", 50)).toBe(48);
    expect(splitForKey("ArrowRight", 50)).toBe(52);
    expect(splitForKey("ArrowLeft", 26)).toBe(25);
    expect(splitForKey("Home", 50)).toBe(25);
    expect(splitForKey("End", 50)).toBe(75);
    expect(splitForKey("a", 50)).toBeNull();
  });
});
