import { describe, expect, it } from "vitest";
import { LINK_TYPES, NOTE_STATUSES } from "./index.js";

describe("shared vocabulary", () => {
  it("has the 7 link types from the PRD", () => {
    expect(LINK_TYPES).toHaveLength(7);
    expect(LINK_TYPES).toContain("related");
  });
  it("has the 5 note statuses from the PRD", () => {
    expect(NOTE_STATUSES).toEqual(["draft", "review", "approved", "implemented", "deprecated"]);
  });
});
