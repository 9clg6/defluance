import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  TEMPLATE_DIR,
  SCHEMA_PATH,
  defaultSchema,
  defaultTemplates,
  initRepo,
  loadSchema,
  loadVault,
  renderTemplate,
  schemaToYaml,
  slugify,
  validateVault,
} from "@defluance/vault-core";
import { existsSync } from "node:fs";

export interface IO {
  out(line: string): void;
  err(line: string): void;
}

const USAGE = `defluance <command>

  init [dir]                        create .defluance/ (schema, templates) and a git repo
  validate [dir]                    check schema, links and orphans; exit 1 on errors
  new <type> <title> [--dir d] [--owner o] [--vault v]
                                    create a note from its template
`;

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function writeIfMissing(root: string, rel: string, content: string, io: IO): Promise<void> {
  const abs = join(root, rel);
  if (await exists(abs)) {
    io.out(`skip    ${rel} (exists)`);
    return;
  }
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  io.out(`create  ${rel}`);
}

async function init(dir: string, io: IO): Promise<number> {
  const root = resolve(dir);
  await mkdir(root, { recursive: true });
  await writeIfMissing(root, SCHEMA_PATH, schemaToYaml(defaultSchema), io);
  for (const [type, tpl] of Object.entries(defaultTemplates)) {
    await writeIfMissing(root, join(TEMPLATE_DIR, `${type}.md`), tpl, io);
  }
  if (!existsSync(join(root, ".git"))) {
    await initRepo(root);
    io.out("create  .git");
  }
  return 0;
}

async function validate(dir: string, io: IO): Promise<number> {
  const root = resolve(dir);
  const schema = await loadSchema(root);
  const vault = await loadVault(root, schema.linkTypes);
  const diags = validateVault(vault, schema);
  for (const d of diags) io.out(`${d.file}:${d.line}  ${d.severity.padEnd(7)}  ${d.rule}  ${d.message}`);
  const errors = diags.filter((d) => d.severity === "error").length;
  const warnings = diags.length - errors;
  io.out(`${vault.notes.length} notes, ${errors} errors, ${warnings} warnings`);
  return errors > 0 ? 1 : 0;
}

function gitUser(): string {
  try {
    return execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

async function newNote(
  type: string,
  title: string,
  opts: { vault: string; dir: string; owner: string },
  io: IO,
): Promise<number> {
  const root = resolve(opts.vault);
  const slug = slugify(title);
  if (!slug) {
    io.err("title must contain letters or digits");
    return 2;
  }
  const abs = resolve(root, opts.dir, `${slug}.md`);
  if (relative(root, abs).startsWith("..")) {
    io.err("--dir must stay inside the vault");
    return 2;
  }
  if (await exists(abs)) {
    io.err(`${relative(root, abs)} already exists`);
    return 1;
  }
  const content = await renderTemplate(root, { type, title, owner: opts.owner });
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  io.out(`create  ${relative(root, abs)}`);
  return 0;
}

/** Entry point, returns the process exit code. */
export async function run(argv: string[], io: IO): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        dir: { type: "string", default: "." },
        owner: { type: "string" },
        vault: { type: "string", default: "." },
        help: { type: "boolean", short: "h" },
      },
    });
    const [cmd, ...rest] = positionals;
    if (values.help || !cmd) {
      io.out(USAGE);
      return cmd || values.help ? 0 : 2;
    }
    switch (cmd) {
      case "init":
        return await init(rest[0] ?? ".", io);
      case "validate":
        return await validate(rest[0] ?? ".", io);
      case "new": {
        const [type, ...title] = rest;
        if (!type || title.length === 0) {
          io.err("usage: defluance new <type> <title>");
          return 2;
        }
        const owner = values.owner ?? (process.env["DEFLUANCE_OWNER"] || gitUser() || process.env["USER"] || "unknown");
        return await newNote(type, title.join(" "), { vault: values.vault, dir: values.dir, owner }, io);
      }
      default:
        io.err(`unknown command "${cmd}"\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e));
    return 1;
  }
}
