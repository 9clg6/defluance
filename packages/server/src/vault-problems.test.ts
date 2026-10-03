import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createContext } from "./context.js";
import { FILES, makeServer } from "./test-env.js";

const later = () => new Promise((r) => setTimeout(r, 25)); // a new mtime

describe("a vault file that does not parse", () => {
  it("does not take the server down: it runs on the defaults and says what is wrong", async () => {
    const s = await makeServer({ files: { ...FILES, ".defluance/config.yaml": "spaces: [unclosed\n  - nope: {" } });
    try {
      const health = await s.call("GET", "/health", { token: null });
      expect(health.status).toBe(200);
      expect(health.body.status).toBe("degraded");
      expect(health.body.checks.vault_files).toMatch(/config\.yaml/);
      expect((await s.call("GET", "/api/v1/notes")).status).toBe(200);
      expect((await s.call("GET", "/api/v1/index/status")).body.problems[0]).toMatch(/config\.yaml/);

      // fixing the file clears it, with no restart
      await later();
      await writeFile(join(s.root, ".defluance/config.yaml"), FILES[".defluance/config.yaml"] as string);
      expect((await s.call("GET", "/health", { token: null })).body).toMatchObject({ status: "ok", checks: { vault_files: "ok" } });
    } finally {
      await s.cleanup();
    }
  });

  it("keeps the last good version when a file is broken after it worked", async () => {
    const s = await makeServer();
    try {
      expect((await s.call("GET", "/api/v1/spaces")).body.map((x: { name: string }) => x.name)).toContain("secret");
      await later();
      await writeFile(join(s.root, ".defluance/config.yaml"), "spaces: [oops");
      // the spaces of the last good config are still in force
      expect((await s.call("GET", "/api/v1/spaces")).body.map((x: { name: string }) => x.name)).toContain("secret");
      expect((await s.call("GET", "/health", { token: null })).body.checks.vault_files).toMatch(/config\.yaml/);

      await later();
      await writeFile(join(s.root, ".defluance/schema.yaml"), "types: [broken: {");
      expect((await s.call("GET", "/api/v1/schema")).status).toBe(200);
      expect((await s.call("GET", "/health", { token: null })).body.checks.vault_files).toMatch(/schema\.yaml/);
    } finally {
      await s.cleanup();
    }
  });
});

describe("a folder that cannot be written", () => {
  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")("explains what to do instead of failing on the first save", async () => {
    const root = await mkdtemp(join(tmpdir(), "dfl-ro-"));
    await mkdir(join(root, "notes"));
    await chmod(root, 0o555);
    try {
      await expect(createContext({ root, env: { DFL_SESSION_SECRET: "test-secret-test-secret" }, log: false })).rejects.toThrow(/not writable by .*--user/);
    } finally {
      await chmod(root, 0o755);
      await rm(root, { recursive: true, force: true });
    }
  });
});
