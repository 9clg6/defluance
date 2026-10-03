import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  DecryptError,
  WrongPassphraseError,
  addRecipient,
  decryptNote,
  encryptNote,
  fingerprintOf,
  generateKeyPair,
  isEncrypted,
  keyringPath,
  protectPrivateKey,
  publicPem,
  readHeader,
  readKeyring,
  removeRecipient,
  resolveRecipients,
  unprotectPrivateKey,
  type ProtectedKey,
  type Recipient,
} from "@defluance/vault-core";
import type { IO } from "./runtime.js";

/** Where your own private keys live on this machine, passphrase-protected. Never in the vault. */
export const keysDir = () => process.env["DFL_KEYS_DIR"] ?? join(homedir(), ".defluance", "keys");

interface LocalKey {
  fp: string;
  label: string;
  public_pem: string;
  protected: ProtectedKey;
}

async function localKeys(): Promise<LocalKey[]> {
  let names: string[];
  try {
    names = await readdir(keysDir());
  } catch {
    return [];
  }
  const out: LocalKey[] = [];
  for (const n of names.filter((x) => /^[0-9a-f]{32}\.key\.json$/.test(x)).sort()) {
    try {
      out.push(JSON.parse(await readFile(join(keysDir(), n), "utf8")) as LocalKey);
    } catch {
      // unreadable: ignore
    }
  }
  return out;
}

/** A passphrase from DFL_PASSPHRASE, or typed with the echo off. */
async function passphrase(prompt: string): Promise<string> {
  const env = process.env["DFL_PASSPHRASE"];
  if (env) return env;
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8").split("\n")[0] ?? "";
  }
  process.stderr.write(prompt);
  return await new Promise<string>((done) => {
    let text = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (b: Buffer) => {
      for (const ch of b.toString("utf8")) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stderr.write("\n");
          return done(text);
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f") text = text.slice(0, -1);
        else text += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function noteFile(vault: string, ref: string): Promise<{ abs: string; id: string }> {
  const id = ref.replace(/\.md$/i, "").replace(/^\.?\//, "");
  const abs = resolve(vault, `${id}.md`);
  if (!abs.startsWith(resolve(vault))) throw new Error("the note must be inside the vault");
  await readFile(abs);
  return { abs, id };
}

async function recipientsByFp(vault: string, fps: string[]): Promise<Recipient[]> {
  const { recipients, missing } = resolveRecipients(await readKeyring(vault), fps);
  if (missing.length) throw new Error(`no public key in the vault keyring for: ${missing.join(", ")} (see "defluance keys add-public")`);
  return recipients;
}

async function unlockLocal(fp: string | undefined, candidates: string[]): Promise<{ key: Awaited<ReturnType<typeof unprotectPrivateKey>>; fp: string }> {
  if (fp && !candidates.includes(fp)) throw new Error("that key is not a recipient of this note");
  const mine = (await localKeys()).filter((k) => (fp ? k.fp === fp : candidates.includes(k.fp)));
  if (!mine.length) throw new Error(candidates.length ? "none of your keys is a recipient of this note" : "you have no key here: run \"defluance keys generate\"");
  const key = mine[0] as LocalKey;
  try {
    return { key: await unprotectPrivateKey(key.protected, await passphrase(`Passphrase for ${key.label}: `)), fp: key.fp };
  } catch (e) {
    if (e instanceof WrongPassphraseError) throw new Error("wrong passphrase");
    throw e;
  }
}

const split = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

export interface CryptoOptions {
  vault: string;
  label?: string | undefined;
  owner?: string | undefined;
  to?: string | undefined;
  from?: string | undefined;
  key?: string | undefined;
  write?: boolean | undefined;
  bits?: number | undefined;
}

export async function keysCommand(rest: string[], o: CryptoOptions, io: IO): Promise<number> {
  const [sub, arg] = rest;
  const vault = resolve(o.vault);
  if (sub === "generate") {
    const label = o.label ?? process.env["USER"] ?? "my key";
    const pass = await passphrase("New passphrase (10 characters or more): ");
    if (pass.length < 10) throw new Error("the passphrase must be at least 10 characters");
    if (process.stdin.isTTY && !process.env["DFL_PASSPHRASE"] && (await passphrase("Again: ")) !== pass) throw new Error("the passphrases differ");
    const pair = await generateKeyPair(o.bits ?? 4096);
    const blob = await protectPrivateKey(pair.privateKey, pass);
    const pem = publicPem(pair.publicKey);
    await mkdir(keysDir(), { recursive: true, mode: 0o700 });
    await writeFile(join(keysDir(), `${pair.fingerprint}.key.json`), `${JSON.stringify({ fp: pair.fingerprint, label, public_pem: pem, protected: blob }, null, 2)}\n`, { mode: 0o600 });
    const entry = { fp: pair.fingerprint, label, owner: `user:${o.owner ?? process.env["USER"] ?? "unknown"}`, pem, created: new Date().toISOString() };
    await mkdir(join(vault, ".defluance/keys"), { recursive: true });
    await writeFile(join(vault, keyringPath(pair.fingerprint)), `${JSON.stringify(entry, null, 2)}\n`);
    io.out(`key ${pair.fingerprint}  ${label}`);
    io.out(`private key (protected): ${join(keysDir(), `${pair.fingerprint}.key.json`)}`);
    io.out(`public key added to the vault keyring: ${keyringPath(pair.fingerprint)} (commit it so others can encrypt for you)`);
    io.out("A forgotten passphrase cannot be recovered. Keep a copy of the key file somewhere safe.");
    return 0;
  }
  if (sub === "list" || !sub) {
    const mine = new Set((await localKeys()).map((k) => k.fp));
    const ring = await readKeyring(vault);
    for (const e of ring) io.out(`${e.fp}  ${e.label.padEnd(24)}  ${e.owner.padEnd(20)}  ${mine.has(e.fp) ? "you hold the private key" : ""}`.trimEnd());
    for (const k of await localKeys()) if (!ring.some((e) => e.fp === k.fp)) io.out(`${k.fp}  ${k.label.padEnd(24)}  (not in this vault's keyring)`);
    if (!ring.length && !mine.size) io.out("no keys yet: defluance keys generate");
    return 0;
  }
  if (sub === "add-public") {
    if (!arg) throw new Error("usage: defluance keys add-public <public-key.pem> --label <name> [--owner <who>]");
    const pem = await readFile(arg, "utf8");
    const fp = fingerprintOf(pem);
    if (!o.label) throw new Error("give the key a name with --label");
    await mkdir(join(vault, ".defluance/keys"), { recursive: true });
    await writeFile(join(vault, keyringPath(fp)), `${JSON.stringify({ fp, label: o.label, owner: o.owner ?? "user:unknown", pem, created: new Date().toISOString() }, null, 2)}\n`);
    io.out(`added ${fp}  ${o.label}`);
    return 0;
  }
  throw new Error("usage: defluance keys generate | list | add-public <file>");
}

/** Encrypt a note file in place. */
export async function encryptCommand(ref: string, o: CryptoOptions, io: IO): Promise<number> {
  const vault = resolve(o.vault);
  const { abs, id } = await noteFile(vault, ref);
  const raw = await readFile(abs, "utf8");
  if (isEncrypted(raw)) throw new Error(`${id} is already encrypted`);
  const fps = split(o.to);
  const own = (await localKeys()).map((k) => k.fp);
  const recipients = await recipientsByFp(vault, [...new Set([...own, ...fps])]);
  if (!recipients.length) throw new Error("no recipient: run \"defluance keys generate\" or pass --to <fingerprints>");
  await writeFile(abs, encryptNote(raw, recipients));
  io.out(`encrypted ${id} for ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}`);
  io.out("Earlier versions stay readable in the git history.");
  return 0;
}

/** Print the plaintext of a private note, or write it back in place with --write. */
export async function decryptCommand(ref: string, o: CryptoOptions, io: IO): Promise<number> {
  const vault = resolve(o.vault);
  const { abs, id } = await noteFile(vault, ref);
  const raw = await readFile(abs, "utf8");
  if (!isEncrypted(raw)) throw new Error(`${id} is not encrypted`);
  const { key, fp } = await unlockLocal(o.key, readHeader(raw).recipients.map((r) => r.fp));
  let plain: string;
  try {
    plain = decryptNote(raw, key, fp);
  } catch (e) {
    if (e instanceof DecryptError) throw new Error(e.message);
    throw e;
  }
  if (o.write) {
    await writeFile(abs, plain);
    io.out(`decrypted ${id} in place`);
  } else {
    io.out(plain.replace(/\n$/, ""));
  }
  return 0;
}

/** Add or remove recipients of a private note. */
export async function shareCommand(ref: string, o: CryptoOptions, io: IO, remove = false): Promise<number> {
  const vault = resolve(o.vault);
  const { abs, id } = await noteFile(vault, ref);
  const raw = await readFile(abs, "utf8");
  if (!isEncrypted(raw)) throw new Error(`${id} is not encrypted`);
  const header = readHeader(raw);
  const fps = split(remove ? o.from : o.to);
  if (!fps.length) throw new Error(remove ? "usage: defluance unshare <note> --from <fingerprints>" : "usage: defluance share <note> --to <fingerprints>");
  const { key, fp } = await unlockLocal(o.key, header.recipients.map((r) => r.fp));
  let file = raw;
  if (remove) {
    const keep = header.recipients.map((r) => r.fp).filter((x) => !fps.includes(x));
    if (!keep.length) throw new Error("a note must keep at least one recipient");
    if (!keep.includes(fp)) throw new Error("you cannot remove the key you are using");
    const resolved = await recipientsByFp(vault, keep);
    for (const f of fps) file = removeRecipient(file, key, fp, f, resolved);
    io.out(`removed ${fps.length} recipient${fps.length === 1 ? "" : "s"} from ${id}; the note is encrypted again under a new key. Copies they already hold stay readable.`);
  } else {
    for (const r of await recipientsByFp(vault, fps)) file = addRecipient(file, key, fp, r);
    io.out(`${id} is now readable by ${fps.length} more recipient${fps.length === 1 ? "" : "s"}`);
  }
  await writeFile(abs, file);
  return 0;
}
