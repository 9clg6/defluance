import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/** E2E_PORT lets two checkouts run the suite at the same time. */
export const PORT = Number(process.env["E2E_PORT"] ?? 4010);
export const TOKEN = "dfl_e2e_token_for_tests";
const vault = join(tmpdir(), `dfl-e2e-vault-${PORT}`);

// Workers re-evaluate this file: only the runner prepares the vault, or it would be wiped under the server.
if (process.env["TEST_WORKER_INDEX"] === undefined) {
  rmSync(vault, { recursive: true, force: true });
  mkdirSync(vault, { recursive: true });
  cpSync(fileURLToPath(new URL("../../fixtures/vault-demo", import.meta.url)), vault, { recursive: true });
  const git = (...a: string[]) => execFileSync("git", ["-C", vault, "-c", "user.name=nadia", "-c", "user.email=n@n", ...a]);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "initial specs");
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: "chrome", locale: "en-US", trace: "retain-on-failure" },
  webServer: {
    command: `node ../../packages/cli/dist/bin.js serve ${vault} --ui ./out --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DFL_ADMIN_TOKEN: TOKEN, DFL_RATE_LIMIT: "0", DFL_RSA_BITS: "2048", DFL_PUBLIC_URL: `http://127.0.0.1:${PORT}` },
  },
});
