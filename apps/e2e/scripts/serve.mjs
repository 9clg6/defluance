// Starts Defluance on a throwaway copy of the demo vault, so every run begins from the same notes.
// The e2e runner passes the port it picked and stops this process when the run ends.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const port = process.argv[2];
if (!port) throw new Error("usage: serve.mjs <port>");

const vault = mkdtempSync(join(tmpdir(), "dfl-e2e-fw-"));
cpSync(join(root, "fixtures/vault-demo"), vault, { recursive: true });
const git = (...a) => execFileSync("git", ["-C", vault, "-c", "user.name=nadia", "-c", "user.email=n@n", ...a]);
git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-q", "-m", "initial specs");

const child = spawn(process.execPath, [join(root, "packages/cli/dist/bin.js"), "serve", vault, "--ui", join(root, "apps/web/out"), "--port", port], { stdio: "inherit" });
const stop = () => child.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => {
  rmSync(vault, { recursive: true, force: true });
  process.exit(code ?? 0);
});
