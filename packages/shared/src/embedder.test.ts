import { describe, expect, it } from "vitest";
import { cosine, hashEmbedder, queryTokens } from "./embedder.js";

describe("hashEmbedder", () => {
  const e = hashEmbedder();
  it("is deterministic and normalised", async () => {
    const [a, b] = await e.embed(["user login flow", "user login flow"]);
    expect(Array.from(a as Float32Array)).toEqual(Array.from(b as Float32Array));
    expect(cosine(a as Float32Array, b as Float32Array)).toBeCloseTo(1, 5);
  });
  it("ranks shared vocabulary above unrelated text", async () => {
    const [q, near, far] = await e.embed(["password reset email", "reset your password by email", "invoice tax rates"]);
    expect(cosine(q as Float32Array, near as Float32Array)).toBeGreaterThan(cosine(q as Float32Array, far as Float32Array));
  });
});

describe("queryTokens", () => {
  it("drops English and French stop words, keeps them if nothing else is left", () => {
    expect(queryTokens("How does the password reset work?")).toEqual(["password", "reset", "work"]);
    expect(queryTokens("Comment réinitialiser le mot de passe")).toEqual(["reinitialiser", "mot", "passe"]);
    expect(queryTokens("what is it")).toEqual(["what", "is", "it"]);
  });
});
