import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DecryptError, decryptNote, encryptNote, generateKeyPair, isEncrypted, type KeyPair } from "./index.js";

const [alice, bob, eve] = (await Promise.all([generateKeyPair(2048), generateKeyPair(2048), generateKeyPair(2048)])) as [KeyPair, KeyPair, KeyPair];
const as = (k: KeyPair) => ({ fp: k.fingerprint, publicKey: k.publicKey });

const note = (body: string) => `---\ntype: technical-spec\nstatus: draft\nowner: nadia\n---\n${body}`;
const body = fc.string({ unit: "grapheme", maxLength: 2000 });

describe("encryption properties", () => {
  it("decrypting what was encrypted returns the exact text, for any content", () => {
    fc.assert(
      fc.property(body, (b) => {
        const plain = note(b);
        const file = encryptNote(plain, [as(alice)]);
        expect(isEncrypted(file)).toBe(true);
        expect(decryptNote(file, alice.privateKey)).toBe(plain);
      }),
      { numRuns: 60 },
    );
  });

  it("every chosen recipient can read it and a stranger cannot", () => {
    fc.assert(
      fc.property(body, fc.subarray([alice, bob], { minLength: 1 }), (b, readers) => {
        const plain = note(b);
        const file = encryptNote(plain, readers.map(as));
        for (const r of readers) expect(decryptNote(file, r.privateKey)).toBe(plain);
        expect(() => decryptNote(file, eve.privateKey)).toThrow(DecryptError);
      }),
      { numRuns: 40 },
    );
  });

  it("any single changed character of the file is detected, never silently accepted", () => {
    const plain = note("The board approved ZEBRAFISH-SECRET-42 on Monday.\n");
    const file = encryptNote(plain, [as(alice)]);
    fc.assert(
      fc.property(fc.nat({ max: file.length - 1 }), fc.string({ minLength: 1, maxLength: 1 }), (at, ch) => {
        fc.pre(file[at] !== ch);
        const tampered = file.slice(0, at) + ch + file.slice(at + 1);
        let result: string | DecryptError;
        try {
          result = decryptNote(tampered, alice.privateKey);
        } catch (e) {
          result = e as DecryptError;
        }
        // Either refused, or (a change that does not alter the meaning, such as trailing whitespace) still the same text.
        if (typeof result === "string") expect(result).toBe(plain);
        else expect(result).toBeInstanceOf(DecryptError);
      }),
      { numRuns: 300 },
    );
  });
});
