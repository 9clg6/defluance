import { describe, expect, it } from "vitest";
import { appCanWrite, normaliseRepo } from "./repo";

describe("normaliseRepo", () => {
  it("keeps owner/name", () => {
    expect(normaliseRepo(" acme/app ")).toBe("acme/app");
    expect(normaliseRepo("my-org/my.repo_2")).toBe("my-org/my.repo_2");
  });

  it("reads a pasted GitHub address", () => {
    expect(normaliseRepo("https://github.com/acme/app")).toBe("acme/app");
    expect(normaliseRepo("https://github.com/acme/app/")).toBe("acme/app");
    expect(normaliseRepo("https://github.com/acme/app/pulls")).toBe("acme/app");
    expect(normaliseRepo("https://github.com/acme/app/pulls?q=is%3Aopen")).toBe("acme/app");
    expect(normaliseRepo("https://github.com/acme/app.git")).toBe("acme/app");
  });

  it("refuses anything else", () => {
    for (const bad of ["", "acme", "acme/", "a/b/c", "https://gitlab.com/acme/app", "https://github.com/acme", "acme app/x", "https://github.com/acme/app/issues/3"]) {
      expect(normaliseRepo(bad), bad).toBeNull();
    }
  });
});

describe("appCanWrite", () => {
  it("offers writing only when the App was given it, and when unknown", () => {
    expect(appCanWrite({ permissions: { issues: "read", pull_requests: "write" } }, "issues")).toBe(false);
    expect(appCanWrite({ permissions: { issues: "read", pull_requests: "write" } }, "pull_requests")).toBe(true);
    expect(appCanWrite({ permissions: { metadata: "read" } }, "issues")).toBe(false);
    expect(appCanWrite({ permissions: null }, "issues")).toBe(true);
    expect(appCanWrite({}, "pull_requests")).toBe(true);
    expect(appCanWrite(undefined, "issues")).toBe(true);
  });
});
