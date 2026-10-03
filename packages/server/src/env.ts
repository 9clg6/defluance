import { z } from "zod";

const csv = z
  .string()
  .optional()
  .transform((v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean));

const schema = z.object({
  DFL_DATA_DIR: z.string().min(1).optional(),
  DFL_DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must start with postgres:// or postgresql://").optional(),
  DFL_SESSION_SECRET: z.string().min(16, "must be at least 16 characters").optional(),
  DFL_PUBLIC_URL: z.url({ protocol: /^https?$/, message: "must be an http(s) URL" }).default("http://localhost:4000"),
  DFL_DEFAULT_ROLE: z.enum(["reader", "editor"]).optional(),
  DFL_ADMINS: csv,
  DFL_ALLOWED_ORIGINS: csv,
  DFL_RATE_LIMIT: z.coerce.number().int().min(0).max(100_000).default(300),
  GITHUB_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof schema>;

/** Read and check the server's environment once, at startup, and report every problem together. */
export function parseEnv(env: Record<string, string | undefined>): ServerEnv {
  const r = schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")));
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `  ${String(i.path[0])}: ${i.message}`);
  throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
}
