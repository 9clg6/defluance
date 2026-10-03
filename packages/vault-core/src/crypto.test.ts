import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DecryptError,
  WrongPassphraseError,
  addRecipient,
  decryptNote,
  encryptNote,
  fingerprintOf,
  generateKeyPair,
  isEncrypted,
  parseNote,
  protectPrivateKey,
  publicPem,
  readHeader,
  readKeyring,
  recipientFingerprints,
  removeRecipient,
  resolveRecipients,
  unprotectPrivateKey,
  writeKeyringEntry,
  type KeyPair,
} from "./index.js";

const NOTE = `---
type: technical-spec
status: draft
owner: nadia
title: Acquisition of Falcon
tags: [secret]
links:
  - "[[other|depends_on]]"
---
# Acquisition of Falcon

The board approved ZEBRAFISH-SECRET-42 on Monday. Price: 12 000 000 €. Accents: éàü 日本語.
`;

// Top-level await: some describe blocks build encrypted files while the tests are being collected.
const [alice, bob, carol] = (await Promise.all([generateKeyPair(2048), generateKeyPair(2048), generateKeyPair(2048)])) as [KeyPair, KeyPair, KeyPair];
const as = (k: KeyPair) => ({ fp: k.fingerprint, publicKey: k.publicKey });

describe("keys", () => {
  it("fingerprints are stable and the same for the key and its PEM", () => {
    expect(alice.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprintOf(alice.publicKey)).toBe(alice.fingerprint);
    expect(fingerprintOf(publicPem(alice.publicKey))).toBe(alice.fingerprint);
    expect(fingerprintOf(alice.privateKey)).toBe(alice.fingerprint);
    expect(alice.fingerprint).not.toBe(bob.fingerprint);
  });

  it("refuses keys that are too small", async () => {
    await expect(generateKeyPair(1024)).rejects.toThrow(/at least 2048/);
  });

  it("generates 4096-bit keys by default", async () => {
    const k = await generateKeyPair();
    expect(k.publicKey.asymmetricKeyDetails?.modulusLength).toBe(4096);
  }, 60_000);
});

describe("encrypt and decrypt", () => {
  it("round-trips a note exactly, including unicode", () => {
    const file = encryptNote(NOTE, [as(alice)]);
    expect(decryptNote(file, alice.privateKey)).toBe(NOTE);
  });

  it("leaves nothing of the content readable, but keeps type, status and owner", () => {
    const file = encryptNote(NOTE, [as(alice)]);
    for (const secret of ["ZEBRAFISH", "Falcon", "12 000", "board", "other", "secret", "日本語"]) expect(file).not.toContain(secret);
    expect(file).toMatch(/^type: technical-spec$/m);
    expect(file).toMatch(/^status: draft$/m);
    expect(file).toMatch(/^owner: nadia$/m);
    expect(isEncrypted(file)).toBe(true);
    const parsed = parseNote("x.md", file);
    expect(parsed.frontmatter["type"]).toBe("technical-spec");
    expect(parsed.links).toEqual([]);
    expect(parsed.title).toBe("x");
  });

  it("uses a new key and IV every time", () => {
    const a = encryptNote(NOTE, [as(alice)]);
    const b = encryptNote(NOTE, [as(alice)]);
    expect(a).not.toBe(b);
    expect(readHeader(a).iv).not.toBe(readHeader(b).iv);
    expect(readHeader(a).recipients[0]?.key).not.toBe(readHeader(b).recipients[0]?.key);
  });

  it("every recipient can read it, nobody else", () => {
    const file = encryptNote(NOTE, [as(alice), as(bob)]);
    expect(decryptNote(file, alice.privateKey)).toBe(NOTE);
    expect(decryptNote(file, bob.privateKey)).toBe(NOTE);
    expect(recipientFingerprints(file).sort()).toEqual([alice.fingerprint, bob.fingerprint].sort());
    expect(() => decryptNote(file, carol.privateKey)).toThrowError(expect.objectContaining({ code: "not-recipient" }));
  });

  it("deduplicates recipients and needs at least one", () => {
    expect(recipientFingerprints(encryptNote(NOTE, [as(alice), as(alice)]))).toEqual([alice.fingerprint]);
    expect(() => encryptNote(NOTE, [])).toThrow(/at least one recipient/);
  });

  it("handles a large note", () => {
    const big = `${NOTE}\n${"lorem ipsum dolor sit amet ".repeat(40_000)}`;
    expect(decryptNote(encryptNote(big, [as(alice)]), alice.privateKey)).toBe(big);
  });

  it("a key claiming someone else's fingerprint cannot unwrap their key", () => {
    const file = encryptNote(NOTE, [as(alice)]);
    expect(() => decryptNote(file, bob.privateKey, alice.fingerprint)).toThrowError(expect.objectContaining({ code: "wrong-key" }));
  });
});

describe("tampering is detected", () => {
  const file = encryptNote(NOTE, [as(alice)]);
  const code = (f: string) => {
    try {
      decryptNote(f, alice.privateKey);
      return "decrypted";
    } catch (e) {
      return e instanceof DecryptError ? e.code : "other";
    }
  };

  it("a changed ciphertext", () => {
    const h = readHeader(file);
    const bad = Buffer.from(h.ciphertext);
    bad[5] = (bad[5] ?? 0) ^ 1;
    const rebuilt = file.slice(0, file.lastIndexOf("---\n") + 4) + bad.toString("base64") + "\n";
    expect(code(rebuilt)).toBe("tampered");
  });

  it("a changed header field: status, owner or type", () => {
    expect(code(file.replace("status: draft", "status: approved"))).toBe("tampered");
    expect(code(file.replace("owner: nadia", "owner: mallory"))).toBe("tampered");
    expect(code(file.replace("type: technical-spec", "type: note"))).toBe("tampered");
  });

  it("a changed IV", () => {
    const iv = readHeader(file).iv;
    const other = Buffer.from(iv, "base64");
    other[0] = (other[0] ?? 0) ^ 1;
    expect(code(file.replace(iv, other.toString("base64")))).toBe("tampered");
  });

  it("a wrapped key swapped for another note's", () => {
    const other = encryptNote(NOTE, [as(alice)]);
    const mine = readHeader(file).recipients[0]?.key as string;
    const theirs = readHeader(other).recipients[0]?.key as string;
    expect(code(file.replace(mine, theirs))).toBe("tampered");
  });

  it("a corrupted wrapped key", () => {
    const mine = readHeader(file).recipients[0]?.key as string;
    expect(code(file.replace(mine, mine.slice(0, 10) + "AAAA" + mine.slice(14)))).toBe("wrong-key");
  });

  it("malformed files give a clear error, never a crash", () => {
    expect(code("# not encrypted")).toBe("malformed");
    expect(code("---\ntype: note\nencrypted: yes\n---\nabc")).toBe("malformed");
    expect(code(file.replace("aes-256-gcm", "aes-128-cbc"))).toBe("malformed");
    expect(code(file.replace(/^ {2}v: 1$/m, "  v: 9"))).toBe("malformed");
    expect(code(file.slice(0, file.lastIndexOf("---\n") + 4))).toBe("malformed");
    expect(code(file.replace(/recipients:[\s\S]*?\n---/, "recipients: []\n---"))).toBe("malformed");
  });
});

describe("isEncrypted", () => {
  it("is true only for an encrypted header, not for a note that talks about it", () => {
    expect(isEncrypted(NOTE)).toBe(false);
    expect(isEncrypted("---\ntype: note\n---\n# T\n\nencrypted:\n  v: 1\n")).toBe(false);
    expect(isEncrypted("no frontmatter\nencrypted:\n")).toBe(false);
    expect(isEncrypted(encryptNote(NOTE, [as(alice)]))).toBe(true);
  });
});

describe("recipients", () => {
  it("adding a recipient only adds a wrapped key: the ciphertext is untouched", () => {
    const file = encryptNote(NOTE, [as(alice)]);
    const withBob = addRecipient(file, alice.privateKey, alice.fingerprint, as(bob));
    expect(readHeader(withBob).ciphertext.equals(readHeader(file).ciphertext)).toBe(true);
    expect(readHeader(withBob).iv).toBe(readHeader(file).iv);
    expect(decryptNote(withBob, bob.privateKey)).toBe(NOTE);
    expect(decryptNote(withBob, alice.privateKey)).toBe(NOTE);
    expect(addRecipient(withBob, alice.privateKey, alice.fingerprint, as(bob))).toBe(withBob);
  });

  it("only someone who can read the note can add a reader", () => {
    const file = encryptNote(NOTE, [as(alice)]);
    expect(() => addRecipient(file, bob.privateKey, bob.fingerprint, as(carol))).toThrowError(expect.objectContaining({ code: "not-recipient" }));
  });

  it("removing a recipient encrypts again under a new key", () => {
    const file = encryptNote(NOTE, [as(alice), as(bob)]);
    const without = removeRecipient(file, alice.privateKey, alice.fingerprint, bob.fingerprint, [as(alice), as(bob)]);
    expect(decryptNote(without, alice.privateKey)).toBe(NOTE);
    expect(() => decryptNote(without, bob.privateKey)).toThrowError(expect.objectContaining({ code: "not-recipient" }));
    expect(readHeader(without).ciphertext.equals(readHeader(file).ciphertext)).toBe(false);
    // the old file is still readable by the removed person: that is the documented limit
    expect(decryptNote(file, bob.privateKey)).toBe(NOTE);
  });

  it("the last recipient cannot be removed", () => {
    const file = encryptNote(NOTE, [as(alice)]);
    expect(() => removeRecipient(file, alice.privateKey, alice.fingerprint, alice.fingerprint, [as(alice)])).toThrow(/at least one recipient/);
  });
});

describe("protecting a private key", () => {
  it("round-trips with the passphrase and stores nothing readable", async () => {
    const blob = await protectPrivateKey(alice.privateKey, "correct horse battery staple", { N: 2 ** 14 });
    const json = JSON.stringify(blob);
    expect(json).not.toContain("BEGIN");
    expect(blob.fp).toBe(alice.fingerprint);
    const key = await unprotectPrivateKey(blob, "correct horse battery staple");
    expect(fingerprintOf(key)).toBe(alice.fingerprint);
    expect(decryptNote(encryptNote(NOTE, [as(alice)]), key)).toBe(NOTE);
  });

  it("a wrong passphrase, a changed blob or a changed fingerprint all fail the same way", async () => {
    const blob = await protectPrivateKey(alice.privateKey, "right passphrase", { N: 2 ** 14 });
    await expect(unprotectPrivateKey(blob, "wrong passphrase")).rejects.toBeInstanceOf(WrongPassphraseError);
    const flipped = Buffer.from(blob.ct, "base64");
    flipped[3] = (flipped[3] ?? 0) ^ 1;
    await expect(unprotectPrivateKey({ ...blob, ct: flipped.toString("base64") }, "right passphrase")).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(unprotectPrivateKey({ ...blob, fp: bob.fingerprint }, "right passphrase")).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("uses a new salt and IV each time", async () => {
    const a = await protectPrivateKey(alice.privateKey, "same passphrase", { N: 2 ** 14 });
    const b = await protectPrivateKey(alice.privateKey, "same passphrase", { N: 2 ** 14 });
    expect(a.salt).not.toBe(b.salt);
    expect(a.ct).not.toBe(b.ct);
  });

  it("refuses an empty passphrase and key files asking for absurd work", async () => {
    await expect(protectPrivateKey(alice.privateKey, "")).rejects.toThrow(/passphrase is required/);
    const blob = await protectPrivateKey(alice.privateKey, "x".repeat(12), { N: 2 ** 14 });
    await expect(unprotectPrivateKey({ ...blob, N: 2 ** 30 }, "x".repeat(12))).rejects.toThrow(/unsupported key derivation/);
    await expect(unprotectPrivateKey({ ...blob, N: 3 }, "x".repeat(12))).rejects.toThrow(/unsupported key derivation/);
    await expect(unprotectPrivateKey({ ...blob, kdf: "md5" } as never, "x")).rejects.toThrow(/unsupported key file/);
  });

  it("the default work factor is strong but fast enough to log in", async () => {
    const t = performance.now();
    const blob = await protectPrivateKey(alice.privateKey, "a long enough passphrase");
    expect(blob.N).toBe(32768);
    await unprotectPrivateKey(blob, "a long enough passphrase");
    expect(performance.now() - t).toBeLessThan(3000);
  });
});

describe("keyring", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "dfl-ring-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const entry = (k: KeyPair, label: string) => ({ fp: k.fingerprint, label, owner: `user:${label}`, pem: publicPem(k.publicKey), created: "2026-10-05T00:00:00Z" });

  it("stores public keys in the vault and resolves recipients from them", async () => {
    await writeKeyringEntry(dir, entry(alice, "alice"));
    await writeKeyringEntry(dir, entry(bob, "bob"));
    const ring = await readKeyring(dir);
    expect(ring.map((e) => e.label)).toEqual(expect.arrayContaining(["alice", "bob"]));
    const { recipients, missing } = resolveRecipients(ring, [alice.fingerprint, carol.fingerprint, alice.fingerprint]);
    expect(recipients.map((r) => r.fp)).toEqual([alice.fingerprint]);
    expect(missing).toEqual([carol.fingerprint]);
    expect(decryptNote(encryptNote(NOTE, recipients), alice.privateKey)).toBe(NOTE);
  });

  it("never contains a private key, and ignores entries that are not what they claim", async () => {
    const files = JSON.stringify(await readKeyring(dir));
    expect(files).not.toContain("PRIVATE");
    await writeFile(join(dir, ".defluance/keys", `${carol.fingerprint}.json`), JSON.stringify({ ...entry(alice, "forged"), fp: carol.fingerprint }));
    expect((await readKeyring(dir)).some((e) => e.fp === carol.fingerprint)).toBe(false);
    await expect(writeKeyringEntry(dir, { ...entry(alice, "x"), fp: bob.fingerprint })).rejects.toThrow(/does not match/);
    await expect(writeKeyringEntry(dir, { ...entry(alice, "x"), fp: "../etc" })).rejects.toThrow(/invalid fingerprint/);
  });

  it("an empty or missing keyring is just empty", async () => {
    expect(await readKeyring(join(dir, "nowhere"))).toEqual([]);
  });
});
