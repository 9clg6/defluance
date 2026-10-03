import { resolve } from "node:path";
import { createContext, indexNow, type Ctx } from "@defluance/server";

export interface IO {
  out(line: string): void;
  err(line: string): void;
}

/** Open the vault's context (database, index), run, close. Logs stay off: stdout may carry a protocol. */
export async function withContext<T>(vault: string, fn: (ctx: Ctx) => Promise<T>, o: { index?: boolean } = {}): Promise<T> {
  const ctx = await createContext({ root: resolve(vault), env: process.env, log: false });
  try {
    if (o.index !== false) await indexNow(ctx);
    return await fn(ctx);
  } finally {
    ctx.jobs.stop();
    await ctx.close();
  }
}
