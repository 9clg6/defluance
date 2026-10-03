import { describe, expect, it } from "vitest";
import { defaultConfig, spaceOf } from "./config.js";

describe("spaceOf", () => {
  const cfg = {
    ...defaultConfig,
    spaces: [
      { name: "produit", path: "produit", repos: [] },
      { name: "infra", path: "tech/infra", repos: [] },
    ],
  };
  it("matches the folder prefix, longest first", () => {
    expect(spaceOf(cfg, "produit/auth")).toBe("produit");
    expect(spaceOf(cfg, "tech/infra/db")).toBe("infra");
  });
  it("falls back to default, and does not match sibling prefixes", () => {
    expect(spaceOf(cfg, "readme")).toBe("default");
    expect(spaceOf(cfg, "produits/x")).toBe("default");
    expect(spaceOf(defaultConfig, "a/b")).toBe("default");
  });
});
