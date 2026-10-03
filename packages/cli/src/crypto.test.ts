import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./index.js";

const PASS = "a long enough passphrase";
const note = `---\ntype: note\nstatus: draft\nowner: ana\n---\n# Falcon\n\nThe board approved ZEBRAFISH-SECRET-42.\n`;

let vault: string;
let keys: string;
let out: string[];
const cli = (...a: string[]) => run(a, { out: (l) => out.push(l), err: (l) => out.push(`ERR ${l}`) });

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), "dfl-crypto-"));
  keys = await mkdtemp(join(tmpdir(), "dfl-keys-"));
  out = [];
  process.env["DFL_KEYS_DIR"] = keys;
  process.env["DFL_PASSPHRASE"] = PASS;
  await mkdir(join(vault, "secret"));
  await writeFile(join(vault, "secret/falcon.md"), note);
  execFileSync("git", ["-C", vault, "init", "-q", "-b", "main"]);
});
afterEach(async () => {
  delete process.env["DFL_KEYS_DIR"];
  delete process.env["DFL_PASSPHRASE"];
  await rm(vault, { recursive: true, force: true });
  await rm(keys, { recursive: true, force: true });
});

const fpOf = () => /key ([0-9a-f]{32})/.exec(out.join("\n"))?.[1] as string;

describe("private notes from the command line", () => {
  it("generates a key, encrypts a note, and decrypts it with the passphrase", async () => {
    expect(await cli("keys", "generate", "--label", "Ana", "--vault", vault, "--bits", "2048")).toBe(0);
    const fp = fpOf();
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(await readFile(join(vault, `.defluance/keys/${fp}.json`), "utf8")).pem).toContain("PUBLIC KEY");
    expect(await readFile(join(keys, `${fp}.key.json`), "utf8")).not.toContain("BEGIN PRIVATE");

    out = [];
    expect(await cli("encrypt", "secret/falcon", "--vault", vault)).toBe(0);
    expect(out.join("\n")).toMatch(/git history/);
    const file = await readFile(join(vault, "secret/falcon.md"), "utf8");
    expect(file).not.toContain("ZEBRAFISH");
    expect(file).toMatch(/^type: note$/m);
    expect(await cli("encrypt", "secret/falcon", "--vault", vault)).toBe(1); // already encrypted

    out = [];
    expect(await cli("decrypt", "secret/falcon", "--vault", vault)).toBe(0);
    expect(out.join("\n")).toContain("ZEBRAFISH-SECRET-42");
    expect(await readFile(join(vault, "secret/falcon.md"), "utf8")).not.toContain("ZEBRAFISH"); // printed, not written

    expect(await cli("decrypt", "secret/falcon", "--vault", vault, "--write")).toBe(0);
    expect(await readFile(join(vault, "secret/falcon.md"), "utf8")).toBe(note);
  });

  it("refuses a wrong passphrase and a key that is not a recipient", async () => {
    await cli("keys", "generate", "--label", "Ana", "--vault", vault, "--bits", "2048");
    await cli("encrypt", "secret/falcon", "--vault", vault);
    process.env["DFL_PASSPHRASE"] = "not the passphrase";
    out = [];
    expect(await cli("decrypt", "secret/falcon", "--vault", vault)).toBe(1);
    expect(out.join("\n")).toContain("wrong passphrase");

    process.env["DFL_PASSPHRASE"] = PASS;
    await cli("keys", "generate", "--label", "Bob", "--vault", vault, "--bits", "2048");
    const bob = /key ([0-9a-f]{32}).*Bob/.exec(out.join("\n"))?.[1] as string;
    out = [];
    expect(await cli("decrypt", "secret/falcon", "--vault", vault, "--key", bob)).toBe(1);
    expect(out.join("\n")).toContain("that key is not a recipient");
  });

  it("shares with a public key from the keyring and unshares", async () => {
    await cli("keys", "generate", "--label", "Ana", "--vault", vault, "--bits", "2048");
    const ana = fpOf();
    await cli("encrypt", "secret/falcon", "--vault", vault);
    out = [];
    await cli("keys", "generate", "--label", "Bob", "--vault", vault, "--bits", "2048");
    const bob = fpOf();

    expect(await cli("share", "secret/falcon", "--to", bob, "--vault", vault, "--key", ana)).toBe(0);
    let header = await readFile(join(vault, "secret/falcon.md"), "utf8");
    expect(header).toContain(bob);
    out = [];
    expect(await cli("decrypt", "secret/falcon", "--vault", vault, "--key", bob)).toBe(0);
    expect(out.join("\n")).toContain("ZEBRAFISH");

    expect(await cli("unshare", "secret/falcon", "--from", bob, "--vault", vault, "--key", ana)).toBe(0);
    header = await readFile(join(vault, "secret/falcon.md"), "utf8");
    expect(header).not.toContain(bob);
    expect(await cli("unshare", "secret/falcon", "--from", ana, "--vault", vault, "--key", ana)).toBe(1);

    out = [];
    expect(await cli("keys", "list", "--vault", vault)).toBe(0);
    expect(out.join("\n")).toMatch(/Ana.*you hold the private key/);
  });

  it("lists nothing helpfully and rejects a bad usage", async () => {
    expect(await cli("keys", "list", "--vault", vault)).toBe(0);
    expect(out.join("\n")).toContain("no keys yet");
    process.env["DFL_PASSPHRASE"] = "short";
    expect(await cli("keys", "generate", "--vault", vault)).toBe(1);
    expect(await cli("encrypt", "--vault", vault)).toBe(2);
  });
});
