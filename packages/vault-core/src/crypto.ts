import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPair as nodeGenerateKeyPair,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  scrypt,
  type KeyObject,
} from "node:crypto";
import { promisify } from "node:util";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/*
 * Hybrid encryption of a note.
 *
 *   DEK        32 random bytes, new for every encryption
 *   body       AES-256-GCM(DEK, random 96-bit IV), the whole original file (frontmatter included)
 *   recipients RSA-OAEP(SHA-256) of the DEK under each recipient's public key
 *
 * `type`, `status` and `owner` stay readable in the file header so the vault can still be validated and listed.
 * They are bound to the ciphertext as GCM additional data: editing them without the key breaks decryption.
 * Everything else, the title, links and text, is only in the ciphertext.
 */

export const ENCRYPTION_VERSION = 1;
export const CIPHER = "aes-256-gcm";
export const MIN_RSA_BITS = 2048;
export const DEFAULT_RSA_BITS = 4096;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, o: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const generateKeyPairAsync = promisify(nodeGenerateKeyPair) as unknown as (
  type: "rsa",
  o: { modulusLength: number; publicExponent: number },
) => Promise<{ publicKey: KeyObject; privateKey: KeyObject }>;

export type DecryptErrorCode = "not-recipient" | "wrong-key" | "tampered" | "malformed";

export class DecryptError extends Error {
  constructor(
    readonly code: DecryptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DecryptError";
  }
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("wrong passphrase");
    this.name = "WrongPassphraseError";
  }
}

// ---------------------------------------------------------------- keys

export interface KeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
  fingerprint: string;
}

/** First 128 bits of SHA-256 over the DER public key, in hex. Names a key in headers, keyrings and the UI. */
export function fingerprintOf(key: KeyObject | string): string {
  const pub = typeof key === "string" ? createPublicKey(key) : key.type === "private" ? createPublicKey(key) : key;
  return createHash("sha256").update(pub.export({ type: "spki", format: "der" })).digest("hex").slice(0, 32);
}

export const publicPem = (key: KeyObject): string => (key.type === "private" ? createPublicKey(key) : key).export({ type: "spki", format: "pem" }).toString();

/** RSA key pair. 4096 bits by default: generation takes a few seconds and runs off the main thread. */
export async function generateKeyPair(bits: number = DEFAULT_RSA_BITS): Promise<KeyPair> {
  if (bits < MIN_RSA_BITS) throw new Error(`RSA keys must have at least ${MIN_RSA_BITS} bits`);
  const { publicKey, privateKey } = await generateKeyPairAsync("rsa", { modulusLength: bits, publicExponent: 0x10001 });
  return { publicKey, privateKey, fingerprint: fingerprintOf(publicKey) };
}

export function parsePublicKey(pem: string): KeyObject {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "rsa") throw new Error("only RSA public keys are supported");
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
  if (bits < MIN_RSA_BITS) throw new Error(`RSA keys must have at least ${MIN_RSA_BITS} bits (this one has ${bits})`);
  return key;
}

// ---------------------------------------------------------------- protecting a private key

/** A private key at rest: scrypt turns the passphrase into an AES-256-GCM key. Safe to store and to back up. */
export interface ProtectedKey {
  v: 1;
  kdf: "scrypt";
  N: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  /** base64 of ciphertext followed by the 16-byte GCM tag */
  ct: string;
  fp: string;
}

const SCRYPT = { N: 2 ** 15, r: 8, p: 1 } as const;
const scryptMem = (N: number, r: number) => 128 * N * r * 2;

export async function protectPrivateKey(privateKey: KeyObject, passphrase: string, o: { N?: number } = {}): Promise<ProtectedKey> {
  if (!passphrase) throw new Error("a passphrase is required");
  const N = o.N ?? SCRYPT.N;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await scryptAsync(passphrase, salt, 32, { N, r: SCRYPT.r, p: SCRYPT.p, maxmem: scryptMem(N, SCRYPT.r) });
  const fp = fingerprintOf(privateKey);
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(Buffer.from(fp));
  const ct = Buffer.concat([cipher.update(privateKey.export({ type: "pkcs8", format: "der" })), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, kdf: "scrypt", N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64"), fp };
}

export async function unprotectPrivateKey(blob: ProtectedKey, passphrase: string): Promise<KeyObject> {
  if (blob.v !== 1 || blob.kdf !== "scrypt") throw new Error("unsupported key file");
  // a key file is untrusted input: refuse parameters that would exhaust memory
  if (!(blob.N >= 2 ** 14 && blob.N <= 2 ** 20 && (blob.N & (blob.N - 1)) === 0 && blob.r === 8 && blob.p === 1)) throw new Error("unsupported key derivation parameters");
  const key = await scryptAsync(passphrase, Buffer.from(blob.salt, "base64"), 32, { N: blob.N, r: blob.r, p: blob.p, maxmem: scryptMem(blob.N, blob.r) });
  const raw = Buffer.from(blob.ct, "base64");
  try {
    const decipher = createDecipheriv(CIPHER, key, Buffer.from(blob.iv, "base64"));
    decipher.setAAD(Buffer.from(blob.fp));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const der = Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]);
    const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    if (fingerprintOf(privateKey) !== blob.fp) throw new Error("fingerprint mismatch");
    return privateKey;
  } catch {
    throw new WrongPassphraseError();
  }
}

// ---------------------------------------------------------------- encrypted files

export interface Recipient {
  fp: string;
  publicKey: KeyObject;
}

export interface EncryptedHeader {
  type: string | null;
  status: string | null;
  owner: string | null;
  v: number;
  cipher: string;
  iv: string;
  recipients: { fp: string; key: string }[];
  ciphertext: Buffer;
}

const aad = (h: Pick<EncryptedHeader, "type" | "status" | "owner" | "v" | "cipher">) => Buffer.from(JSON.stringify({ v: h.v, cipher: h.cipher, type: h.type, status: h.status, owner: h.owner }));

/** Cheap test for the indexer, which asks this of every file. */
export function isEncrypted(raw: string): boolean {
  const m = FRONTMATTER.exec(raw);
  return !!m && /^encrypted:\s*$/m.test(m[1] ?? "");
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function readHeader(raw: string): EncryptedHeader {
  const m = FRONTMATTER.exec(raw);
  if (!m) throw new DecryptError("malformed", "not an encrypted note");
  let data: Record<string, unknown>;
  try {
    data = (parseYaml(m[1] ?? "") ?? {}) as Record<string, unknown>;
  } catch {
    throw new DecryptError("malformed", "unreadable header");
  }
  const e = data["encrypted"] as Record<string, unknown> | undefined;
  if (!e || typeof e !== "object") throw new DecryptError("malformed", "not an encrypted note");
  if (e["v"] !== ENCRYPTION_VERSION) throw new DecryptError("malformed", `unsupported encryption version ${String(e["v"])}`);
  if (e["cipher"] !== CIPHER) throw new DecryptError("malformed", `unsupported cipher ${String(e["cipher"])}`);
  const iv = str(e["iv"]);
  const rec = Array.isArray(e["recipients"]) ? (e["recipients"] as Record<string, unknown>[]) : [];
  const recipients = rec.flatMap((r) => (str(r["fp"]) && str(r["key"]) ? [{ fp: r["fp"] as string, key: r["key"] as string }] : []));
  if (!iv || recipients.length === 0) throw new DecryptError("malformed", "the header has no iv or no recipients");
  const body = raw.slice(m[0].length).replace(/\s+/g, "");
  if (!body) throw new DecryptError("malformed", "the note has no ciphertext");
  return { type: str(data["type"]), status: str(data["status"]), owner: str(data["owner"]), v: ENCRYPTION_VERSION, cipher: CIPHER, iv, recipients, ciphertext: Buffer.from(body, "base64") };
}

export function recipientFingerprints(raw: string): string[] {
  return readHeader(raw).recipients.map((r) => r.fp);
}

function render(h: Omit<EncryptedHeader, "ciphertext">, ciphertext: Buffer): string {
  const header = stringifyYaml(
    {
      ...(h.type ? { type: h.type } : {}),
      ...(h.status ? { status: h.status } : {}),
      ...(h.owner ? { owner: h.owner } : {}),
      encrypted: { v: h.v, cipher: h.cipher, iv: h.iv, recipients: h.recipients },
    },
    { lineWidth: 0 },
  );
  const body = ciphertext.toString("base64").replace(/(.{76})/g, "$1\n");
  return `---\n${header}---\n${body}\n`;
}

const wrap = (dek: Buffer, r: Recipient) => publicEncrypt({ key: r.publicKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, dek).toString("base64");

/**
 * Encrypt a whole note (file text, frontmatter included) for one or more recipients.
 * A fresh key and IV every time, so the same note encrypted twice gives different files.
 */
export function encryptNote(plain: string, recipients: Recipient[]): string {
  const unique = [...new Map(recipients.map((r) => [r.fp, r])).values()];
  if (unique.length === 0) throw new Error("an encrypted note needs at least one recipient");
  // Only the header is needed: parsing the whole note would be slow for a large one.
  let inner: Record<string, unknown> = {};
  try {
    const parsed: unknown = parseYaml(FRONTMATTER.exec(plain)?.[1] ?? "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) inner = parsed as Record<string, unknown>;
  } catch {
    // no readable frontmatter: nothing to keep in clear
  }
  const head = { type: str(inner["type"]), status: str(inner["status"]), owner: str(inner["owner"]), v: ENCRYPTION_VERSION, cipher: CIPHER };
  const dek = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, dek, iv);
  cipher.setAAD(aad(head));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return render({ ...head, iv: iv.toString("base64"), recipients: unique.map((r) => ({ fp: r.fp, key: wrap(dek, r) })) }, ct);
}

function unwrapDek(h: EncryptedHeader, privateKey: KeyObject, fp: string): Buffer {
  const mine = h.recipients.find((r) => r.fp === fp);
  if (!mine) throw new DecryptError("not-recipient", "this key is not a recipient of the note");
  try {
    return privateDecrypt({ key: privateKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(mine.key, "base64"));
  } catch {
    throw new DecryptError("wrong-key", "the key could not unwrap the note key");
  }
}

function open(h: EncryptedHeader, dek: Buffer): string {
  if (h.ciphertext.length < 16) throw new DecryptError("malformed", "the ciphertext is too short");
  try {
    const d = createDecipheriv(CIPHER, dek, Buffer.from(h.iv, "base64"));
    d.setAAD(aad(h));
    d.setAuthTag(h.ciphertext.subarray(h.ciphertext.length - 16));
    return Buffer.concat([d.update(h.ciphertext.subarray(0, h.ciphertext.length - 16)), d.final()]).toString("utf8");
  } catch {
    throw new DecryptError("tampered", "the note was modified or is corrupted");
  }
}

/** Decrypt with a private key whose fingerprint is `fp`. Throws DecryptError with a precise code. */
export function decryptNote(raw: string, privateKey: KeyObject, fp: string = fingerprintOf(privateKey)): string {
  const h = readHeader(raw);
  return open(h, unwrapDek(h, privateKey, fp));
}

/**
 * Let one more person read the note. Only the small wrapped key is added: the ciphertext is untouched,
 * so the diff is a few lines. The caller must be able to decrypt it already.
 */
export function addRecipient(raw: string, privateKey: KeyObject, fp: string, add: Recipient): string {
  const h = readHeader(raw);
  const dek = unwrapDek(h, privateKey, fp);
  open(h, dek); // refuse to hand out the key of a note that does not verify
  if (h.recipients.some((r) => r.fp === add.fp)) return raw;
  return render({ ...h, recipients: [...h.recipients, { fp: add.fp, key: wrap(dek, add) }] }, h.ciphertext);
}

/**
 * Take a person off the list. The note is encrypted again under a new key for the others.
 * Anyone who kept an old copy (git history, a backup) can still read that old copy: rotate the content if it matters.
 */
export function removeRecipient(raw: string, privateKey: KeyObject, fp: string, remove: string, keep: Recipient[]): string {
  const remaining = keep.filter((r) => r.fp !== remove);
  if (remaining.length === 0) throw new Error("a note must keep at least one recipient");
  return encryptNote(decryptNote(raw, privateKey, fp), remaining);
}
