import { expect, it } from "vitest";
import type { Link } from "./index.js";

it("links default vocabulary is shared", () => {
  const l: Link = { target: "auth-login", type: "implements" };
  expect(l.type).toBe("implements");
});
