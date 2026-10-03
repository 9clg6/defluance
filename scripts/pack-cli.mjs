// Builds the publishable `defluance` npm package in dist-npm/: one bundled file, the web UI, the license files.
// With --verify it installs the tarball in a clean folder and runs it, so what ships is what was tested.
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(new URL("..", import.meta.url).pathname);
const out = join(root, "dist-npm");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
/** Run and capture text; on failure, show what the program printed instead of a byte dump. */
const sh = (cmd, args, opts = {}) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe", ...opts });
  } catch (e) {
    throw new Error(`${cmd} ${args.join(" ")} failed:\n${e.stderr ?? ""}${e.stdout ?? ""}`, { cause: e });
  }
};

console.log("1/4 build workspace and web UI");
run("pnpm", ["build"]);
if (!existsSync(join(root, "apps/web/out/index.html"))) throw new Error("apps/web/out is missing: the web build did not export the UI");

console.log("2/4 bundle");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(root, "packages/cli/src/bin.ts")],
  outfile: join(out, "bin.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "import { createRequire as __cr } from 'node:module';\nconst require = __cr(import.meta.url);" },
  plugins: [
    {
      name: "externalise-dependencies",
      // our packages are inlined, every other bare import stays a dependency
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (a) => (a.path.startsWith("@defluance/") || a.path.startsWith("node:") ? undefined : { path: a.path, external: true }));
      },
    },
  ],
  logLevel: "warning",
});
chmodSync(join(out, "bin.js"), 0o755);

console.log("3/4 package");
cpSync(join(root, "apps/web/out"), join(out, "ui"), { recursive: true });
for (const f of ["LICENSE", "COMMERCIAL.md", "README.md"]) if (existsSync(join(root, f))) cpSync(join(root, f), join(out, f));

const deps = {};
for (const dir of readdirSync(join(root, "packages"))) {
  const pkg = JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8"));
  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) if (!name.startsWith("@defluance/") && name !== "defluance") deps[name] = range;
}
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "0.1.0";
writeFileSync(
  join(out, "package.json"),
  JSON.stringify(
    {
      name: "defluance",
      version,
      description: "Specs, decisions and issues as one linked graph, for people and AI agents. Markdown vault, REST API, MCP server, GitHub connector.",
      license: "SEE LICENSE IN LICENSE",
      type: "module",
      bin: { defluance: "bin.js" },
      files: ["bin.js", "ui", "LICENSE", "COMMERCIAL.md", "README.md"],
      engines: { node: ">=22.13" },
      keywords: ["markdown", "specs", "knowledge-graph", "mcp", "rag", "obsidian"],
      dependencies: Object.fromEntries(Object.entries(deps).sort()),
    },
    null,
    2,
  ) + "\n",
);
console.log(`   ${Object.keys(deps).length} runtime dependencies`);

if (process.argv.includes("--no-pack")) process.exit(0); // the Docker build only needs the staged folder

console.log("4/4 npm pack");
const packed = execFileSync("npm", ["pack", "--json", "--pack-destination", out], { cwd: out, encoding: "utf8" });
const info = JSON.parse(packed)[0];
console.log(`   ${info.filename}: ${(info.size / 1024 / 1024).toFixed(1)} MB packed, ${info.entryCount} files`);

if (process.argv.includes("--verify")) {
  console.log("verify: installing the tarball in a clean folder");
  const tmp = mkdtempSync(join(tmpdir(), "dfl-verify-"));
  try {
    writeFileSync(join(tmp, "package.json"), '{"name":"verify","private":true}');
    execFileSync("npm", ["install", join(out, info.filename), "--no-audit", "--no-fund", "--loglevel=error"], { cwd: tmp, stdio: "inherit" });
    const bin = join(tmp, "node_modules/.bin/defluance");
    const vault = join(tmp, "vault");
    sh(bin, ["init", vault]);
    sh(bin, ["new", "note", "Hello", "--vault", vault, "--owner", "ci"]);
    const validate = sh(bin, ["validate", vault]);
    console.log(`   validate: ${validate.trim().split("\n").at(-1)}`);

    const port = 4377;
    const server = spawn(bin, ["serve", vault, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DFL_ADMIN_TOKEN: "dfl_verify_token" } });
    let log = "";
    server.stdout.on("data", (d) => (log += d));
    server.stderr.on("data", (d) => (log += d));
    try {
      let ok = false;
      for (let i = 0; i < 60 && !ok; i++) {
        await new Promise((r) => setTimeout(r, 500));
        ok = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false);
      }
      if (!ok) throw new Error(`server did not start:\n${log}`);
      const page = await (await fetch(`http://127.0.0.1:${port}/login/`)).text();
      if (!page.includes("Defluance")) throw new Error("the bundled UI was not served");
      const me = await fetch(`http://127.0.0.1:${port}/api/v1/notes`, { headers: { authorization: "Bearer dfl_verify_token" } });
      const list = await me.json();
      if (list.items?.[0]?.id !== "hello") throw new Error(`unexpected API answer: ${JSON.stringify(list)}`);
      console.log("   serve: health ok, UI served, API answers with the new note");
    } finally {
      server.kill("SIGTERM");
    }
    console.log("verified");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
