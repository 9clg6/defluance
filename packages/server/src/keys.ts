import type { KeyObject } from "node:crypto";
import {
  WrongPassphraseError,
  fingerprintOf,
  generateKeyPair,
  keyringPath,
  parsePublicKey,
  protectPrivateKey,
  publicPem,
  unprotectPrivateKey,
  writeAndCommit,
  type Author,
  type ProtectedKey,
  type Recipient,
} from "@defluance/vault-core";
import { HttpError } from "./errors.js";
import type { KeyRow, SystemStore } from "./system.js";

/** A private key that is unlocked in memory right now. It is never written anywhere. */
export interface Held {
  fp: string;
  label: string;
  key: KeyObject;
  /** When the key stops being usable if nobody uses it. */
  expires: number;
}

export interface KeyOptions {
  /** RSA modulus length. 4096 by default; tests use 2048 (the minimum) to stay fast. */
  bits?: number;
  /** scrypt cost of the passphrase protection. */
  kdfN?: number;
  /** An unlocked key is forgotten after this long without use. */
  idleMs?: number;
  /** ...and after this long whatever happens. */
  maxMs?: number;
  /** Wrong passphrases allowed per key and window before a lockout. */
  attempts?: number;
  windowMs?: number;
}

export interface KeyStatus {
  fp: string;
  label: string;
  bound: "passphrase" | "token";
  created_at: string;
  unlocked: boolean;
  /** ISO time when an idle key locks itself, if unlocked. */
  expires_at: string | null;
}

interface Entry {
  key: KeyObject;
  label: string;
  since: number;
  last: number;
}

/**
 * Keys of people and agents.
 *
 * The public half goes in the vault keyring (git), so recipients can be named. The private half is stored only as a
 * passphrase-protected blob in the database. Unlocking decrypts it into memory for one holder (a user or a token),
 * with an idle timeout and an absolute limit; locking, expiry and token revocation drop it. A key bound to an API token
 * is protected by the token itself, so an agent that sends its token can read the notes it was given, and nobody else can.
 */
export class KeyService {
  readonly bits: number;
  private readonly kdfN: number | undefined;
  private readonly idleMs: number;
  private readonly maxMs: number;
  private readonly attempts: number;
  private readonly windowMs: number;
  private readonly held = new Map<string, Map<string, Entry>>();
  private readonly failures = new Map<string, { count: number; first: number }>();
  private tokenOwners: Set<string> | null = null;

  constructor(
    private readonly sys: SystemStore,
    private readonly root: string,
    private readonly now: () => Date,
    o: KeyOptions = {},
  ) {
    this.bits = o.bits ?? 4096;
    this.kdfN = o.kdfN;
    this.idleMs = o.idleMs ?? 30 * 60_000;
    this.maxMs = o.maxMs ?? 8 * 3_600_000;
    this.attempts = o.attempts ?? 5;
    this.windowMs = o.windowMs ?? 15 * 60_000;
  }

  private t = () => this.now().getTime();

  /** Create a key pair for an owner. Returns the public part; the private part exists only as a protected blob. */
  async create(owner: { kind: "user" | "token"; id: string }, o: { label: string; passphrase: string; bound: "passphrase" | "token"; author: Author }): Promise<KeyRow> {
    if (o.bound === "passphrase" && o.passphrase.length < 10) throw new HttpError(422, "the passphrase must be at least 10 characters");
    const label = o.label.trim().slice(0, 80);
    if (!label) throw new HttpError(422, "give the key a name");
    const pair = await generateKeyPair(this.bits);
    const blob = await protectPrivateKey(pair.privateKey, o.passphrase, this.kdfN ? { N: this.kdfN } : {});
    const pem = publicPem(pair.publicKey);
    const row = await this.sys.addKey({ fp: pair.fingerprint, owner_kind: owner.kind, owner_id: owner.id, label, public_pem: pem, protected: JSON.stringify(blob), bound: o.bound });
    const entry = { fp: row.fp, label, owner: `${owner.kind}:${owner.id}`, pem, created: row.created_at };
    await writeAndCommit(this.root, keyringPath(row.fp), `${JSON.stringify(entry, null, 2)}\n`, { message: `add public key ${label}`, author: o.author });
    if (o.bound === "token") this.tokenOwners?.add(owner.id);
    return row;
  }

  /** Unlock one of the holder's own keys with its passphrase. Wrong guesses are counted and lock the key out for a while. */
  async unlock(holder: string, fp: string, passphrase: string): Promise<KeyStatus> {
    const row = await this.sys.getKey(fp);
    if (!row || row.owner_id !== holder) throw new HttpError(404, "key not found");
    if (row.bound === "token") throw new HttpError(422, "this key is unlocked by its API token, not by a passphrase");
    const id = `${holder}:${fp}`;
    const f = this.failures.get(id);
    const now = this.t();
    if (f && now - f.first > this.windowMs) this.failures.delete(id);
    const cur = this.failures.get(id);
    if (cur && cur.count >= this.attempts) {
      throw new HttpError(429, "too many wrong passphrases, try again later", { retry_after: Math.ceil((cur.first + this.windowMs - now) / 1000) });
    }
    let key: KeyObject;
    try {
      key = await unprotectPrivateKey(JSON.parse(row.protected) as ProtectedKey, passphrase);
    } catch (e) {
      if (!(e instanceof WrongPassphraseError)) throw e;
      this.failures.set(id, { count: (cur?.count ?? 0) + 1, first: cur?.first ?? now });
      throw new HttpError(401, "wrong passphrase");
    }
    this.failures.delete(id);
    this.hold(holder, row, key);
    return this.statusOf(row, holder);
  }

  /** An agent's own token unlocks the keys bound to it. Cheap when nothing is bound: one set lookup. */
  async unlockWithToken(tokenId: string, plaintext: string): Promise<void> {
    if (!this.tokenOwners) this.tokenOwners = new Set((await this.sys.allKeys()).filter((k) => k.bound === "token").map((k) => k.owner_id));
    if (!this.tokenOwners.has(tokenId)) return;
    const live = this.held.get(tokenId);
    for (const row of (await this.sys.keysOf(tokenId)).filter((k) => k.bound === "token")) {
      const e = live?.get(row.fp);
      if (e && this.alive(e)) {
        e.last = this.t();
        continue;
      }
      try {
        this.hold(tokenId, row, await unprotectPrivateKey(JSON.parse(row.protected) as ProtectedKey, plaintext));
      } catch {
        // not this token's key after all: leave it locked
      }
    }
  }

  private hold(holder: string, row: KeyRow, key: KeyObject) {
    const now = this.t();
    const m = this.held.get(holder) ?? new Map<string, Entry>();
    m.set(row.fp, { key, label: row.label, since: now, last: now });
    this.held.set(holder, m);
  }

  private alive = (e: Entry) => this.t() - e.last <= this.idleMs && this.t() - e.since <= this.maxMs;

  /** Keys the holder has unlocked and that have not expired. Using them keeps them unlocked. */
  heldBy(holder: string): Held[] {
    const m = this.held.get(holder);
    if (!m) return [];
    const out: Held[] = [];
    for (const [fp, e] of m) {
      if (!this.alive(e)) {
        m.delete(fp);
        continue;
      }
      e.last = this.t();
      out.push({ fp, label: e.label, key: e.key, expires: Math.min(e.last + this.idleMs, e.since + this.maxMs) });
    }
    return out;
  }

  /** Lock one key, or every key of the holder. */
  lock(holder: string, fp?: string): void {
    const m = this.held.get(holder);
    if (!m) return;
    if (fp) m.delete(fp);
    else m.clear();
  }

  /** Forget everything of a holder: a revoked token, a deleted key. */
  forget(holder: string): void {
    this.held.delete(holder);
  }

  async delete(holder: string, fp: string): Promise<void> {
    const row = await this.sys.getKey(fp);
    if (!row || row.owner_id !== holder) throw new HttpError(404, "key not found");
    this.lock(holder, fp);
    await this.sys.deleteKey(fp);
  }

  private statusOf(row: KeyRow, holder: string): KeyStatus {
    const e = this.held.get(holder)?.get(row.fp);
    const live = !!e && this.alive(e);
    return {
      fp: row.fp,
      label: row.label,
      bound: row.bound,
      created_at: row.created_at,
      unlocked: live,
      expires_at: live && e ? new Date(Math.min(e.last + this.idleMs, e.since + this.maxMs)).toISOString() : null,
    };
  }

  /** The holder's own keys, and which are unlocked. Does not extend the timeout. */
  async statusFor(holder: string): Promise<KeyStatus[]> {
    return (await this.sys.keysOf(holder)).map((r) => this.statusOf(r, holder));
  }

  /** The holder's public keys as recipients: what a note they create is encrypted for by default. */
  async recipientsOf(holder: string): Promise<Recipient[]> {
    return (await this.sys.keysOf(holder)).map((r) => ({ fp: r.fp, publicKey: parsePublicKey(r.public_pem) }));
  }

  /** Check a public key matches its fingerprint (used when importing a key made elsewhere). */
  static check(pem: string): string {
    parsePublicKey(pem);
    return fingerprintOf(pem);
  }
}
