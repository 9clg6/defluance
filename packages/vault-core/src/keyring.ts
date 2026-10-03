import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fingerprintOf, parsePublicKey, type Recipient } from "./crypto.js";

/** Public keys of the people (and agents) who can be recipients. Public: it lives in the vault and in git. */
export const KEYRING_DIR = ".defluance/keys";

export interface KeyringEntry {
  fp: string;
  /** What the person sees: "Nadia's key", "recovery key". */
  label: string;
  /** `user:nadia` or `token:claude-code`. */
  owner: string;
  pem: string;
  created: string;
}

export const keyringPath = (fp: string) => `${KEYRING_DIR}/${fp}.json`;

export async function writeKeyringEntry(root: string, entry: KeyringEntry): Promise<string> {
  if (!/^[0-9a-f]{32}$/.test(entry.fp)) throw new Error("invalid fingerprint");
  if (fingerprintOf(entry.pem) !== entry.fp) throw new Error("the fingerprint does not match the public key");
  parsePublicKey(entry.pem);
  const path = keyringPath(entry.fp);
  await mkdir(join(root, KEYRING_DIR), { recursive: true });
  await writeFile(join(root, path), `${JSON.stringify(entry, null, 2)}\n`);
  return path;
}

/** Every valid entry. A file whose fingerprint does not match its key is ignored: a recipient must be what it claims. */
export async function readKeyring(root: string): Promise<KeyringEntry[]> {
  let names: string[];
  try {
    names = await readdir(join(root, KEYRING_DIR));
  } catch {
    return [];
  }
  const out: KeyringEntry[] = [];
  for (const name of names.filter((n) => /^[0-9a-f]{32}\.json$/.test(n)).sort()) {
    try {
      const e = JSON.parse(await readFile(join(root, KEYRING_DIR, name), "utf8")) as KeyringEntry;
      if (e.fp === name.slice(0, 32) && fingerprintOf(e.pem) === e.fp) {
        parsePublicKey(e.pem);
        out.push(e);
      }
    } catch {
      // unreadable or invalid: skip
    }
  }
  return out;
}

/** Turn fingerprints into recipients using the keyring, and say which ones are unknown. */
export function resolveRecipients(entries: KeyringEntry[], fps: string[]): { recipients: Recipient[]; missing: string[] } {
  const by = new Map(entries.map((e) => [e.fp, e]));
  const recipients: Recipient[] = [];
  const missing: string[] = [];
  for (const fp of new Set(fps)) {
    const e = by.get(fp);
    if (e) recipients.push({ fp, publicKey: parsePublicKey(e.pem) });
    else missing.push(fp);
  }
  return { recipients, missing };
}
