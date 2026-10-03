import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { startServer, type RunningServer } from "@defluance/server";
import type { IO } from "./runtime.js";

/** The exported web UI bundled with the package (`packages/cli/ui`), if built. */
export function bundledUi(): string | null {
  const dir = fileURLToPath(new URL("../../ui", import.meta.url));
  return existsSync(dir) ? dir : null;
}

export interface ServeOptions {
  port?: number;
  host?: string;
  ui?: string | undefined;
  open?: boolean;
}

export async function startServe(vault: string, o: ServeOptions, io: IO): Promise<RunningServer> {
  const ui = o.ui ? resolve(o.ui) : bundledUi();
  const env = process.env;
  const running = await startServer({
    root: resolve(vault),
    port: o.port ?? Number(env["DFL_PORT"] ?? env["PORT"] ?? 4000),
    host: o.host ?? env["DFL_HOST"] ?? "127.0.0.1",
    localMode: true,
    uiDir: ui,
    env,
  });
  io.out(`Defluance is running at ${running.url}`);
  io.out(`Vault: ${resolve(vault)}`);
  io.out(`Embeddings: ${running.ctx.embedder.model}. Answers: ${running.ctx.llm?.id ?? "extractive (set DFL_LLM for generated answers)"}`);
  if (!ui) io.out("The web UI is not bundled in this build: only the API and MCP are served.");
  if (running.bootstrapToken) {
    io.out("");
    io.out("First start: an admin token was created. It is shown once.");
    io.out(`  ${running.bootstrapToken}`);
    io.out(`Sign in: ${running.url}/login#token=${running.bootstrapToken}`);
    io.out("Create more tokens with: defluance token create <name> --scopes read,write");
  }
  io.out(`MCP endpoint: ${running.url}/mcp (Authorization: Bearer <token>)`);
  if (o.open && ui) {
    const url = running.bootstrapToken ? `${running.url}/login#token=${running.bootstrapToken}` : running.url;
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    execFile(cmd, [url], () => undefined);
  }
  return running;
}

/** Run until SIGINT or SIGTERM. */
export async function serve(vault: string, o: ServeOptions, io: IO): Promise<number> {
  const running = await startServe(vault, o, io);
  await new Promise<void>((done) => {
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
  await running.close();
  return 0;
}
