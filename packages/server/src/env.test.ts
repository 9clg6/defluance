import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

describe("environment validation", () => {
  it("applies defaults and splits lists", () => {
    const e = parseEnv({ DFL_ADMINS: "ana, bo ,", DFL_ALLOWED_ORIGINS: "https://a.example" });
    expect(e.DFL_PUBLIC_URL).toBe("http://localhost:4000");
    expect(e.DFL_RATE_LIMIT).toBe(300);
    expect(e.DFL_ADMINS).toEqual(["ana", "bo"]);
    expect(e.DFL_ALLOWED_ORIGINS).toEqual(["https://a.example"]);
  });

  it("treats empty variables as unset", () => {
    expect(parseEnv({ DFL_DEFAULT_ROLE: "", DFL_PUBLIC_URL: "" }).DFL_DEFAULT_ROLE).toBeUndefined();
  });

  it("reports every problem at once instead of the first", () => {
    const run = () => parseEnv({ DFL_PUBLIC_URL: "not a url", DFL_DEFAULT_ROLE: "owner", DFL_RATE_LIMIT: "-4", DFL_SESSION_SECRET: "short", DFL_DATABASE_URL: "mysql://x" });
    expect(run).toThrow(/Invalid configuration/);
    try {
      run();
    } catch (e) {
      const m = (e as Error).message;
      for (const k of ["DFL_PUBLIC_URL", "DFL_DEFAULT_ROLE", "DFL_RATE_LIMIT", "DFL_SESSION_SECRET", "DFL_DATABASE_URL"]) expect(m).toContain(k);
    }
  });
});
