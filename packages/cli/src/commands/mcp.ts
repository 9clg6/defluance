import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer, createContext, indexNow, type Actor } from "@defluance/server";
import { resolve } from "node:path";

/** The person who started `defluance mcp` is the person using it, but the caller is still an agent: drafts on branches, no approvals. */
export const stdioActor = (name: string): Actor => ({
  kind: "token",
  id: "stdio",
  name,
  agent: true,
  grants: [{ space: "*", perms: new Set(["read", "write", "issues"] as const) }],
});

export async function mcpStdio(vault: string): Promise<number> {
  const ctx = await createContext({ root: resolve(vault), env: process.env, log: false });
  await indexNow(ctx);
  const server: McpServer = buildMcpServer(ctx, stdioActor(process.env["DFL_ACTOR"] ?? "mcp-stdio"));
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((done) => {
    transport.onclose = done;
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
  await server.close();
  ctx.jobs.stop();
  await ctx.close();
  return 0;
}
