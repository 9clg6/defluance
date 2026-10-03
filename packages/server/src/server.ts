import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createContext, indexNow, jobHandlers, type Ctx, type ContextOptions } from "./context.js";
import { githubFromEnv } from "./github/service.js";
import { PERMS } from "./system.js";

export interface ServerOptions extends ContextOptions {
  port?: number;
  host?: string;
}

export interface RunningServer {
  ctx: Ctx;
  url: string;
  port: number;
  /** Plaintext admin token, only set when one was created on this start. Shown once. */
  bootstrapToken: string | null;
  close(): Promise<void>;
}

/** Make sure someone can sign in: `DFL_ADMIN_TOKEN` if given, else a generated token on first start. */
export async function ensureBootstrap(ctx: Ctx, env = process.env): Promise<string | null> {
  const fixed = env["DFL_ADMIN_TOKEN"];
  if (fixed) {
    await ctx.sys.ensureToken(fixed, { name: "bootstrap", scopes: [...PERMS], createdBy: "system" });
    return null;
  }
  if ((await ctx.sys.tokenCount()) > 0) return null;
  return (await ctx.sys.createToken({ name: "bootstrap", scopes: [...PERMS], spaces: [], createdBy: "system" })).token;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const ctx = await createContext(opts);
  ctx.github ??= githubFromEnv(ctx, opts.env ?? process.env);
  const bootstrapToken = await ensureBootstrap(ctx, opts.env ?? process.env);
  await ctx.jobs.recover();
  await indexNow(ctx);
  ctx.jobs.start(jobHandlers(ctx));
  const { app } = createApp(ctx);

  const requested = opts.port ?? 4000;
  const host = opts.host ?? "127.0.0.1";
  const server = serve({ fetch: app.fetch, port: requested, hostname: host });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requested;
  return {
    ctx,
    port,
    url: `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`,
    bootstrapToken,
    async close() {
      ctx.jobs.stop();
      await new Promise<void>((r) => server.close(() => r()));
      await ctx.close();
    },
  };
}
