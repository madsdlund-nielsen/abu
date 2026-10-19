import { describe, expect, it } from "vitest";
import { decryptSecret, deriveMfaKey, DEV_MFA_KEY_MATERIAL, encryptSecret, keyIdOf, MfaDecryptError, mfaKeysFrom } from "./crypto";

const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const KEY = deriveMfaKey("en-lang-tilfældig-nøgle-til-test-0123456789");

describe("AES-256-GCM-kryptering af TOTP-hemmeligheder", () => {
  it("round-trip, og ny IV hver gang (samme klartekst giver forskellig chiffertekst)", () => {
    const a = encryptSecret(SECRET, KEY, "abu-user:u1");
    const b = encryptSecret(SECRET, KEY, "abu-user:u1");
    expect(a).not.toBe(b);
    expect(a).not.toContain(SECRET);
    expect(a.split(".")).toHaveLength(5);
    expect(keyIdOf(a)).toBe(KEY.id);
    expect(decryptSecret(a, [KEY], "abu-user:u1")).toBe(SECRET);
    expect(decryptSecret(b, [KEY], "abu-user:u1")).toBe(SECRET);
  });

  it("opdager manipulation af chiffertekst, tag og IV", () => {
    const enc = encryptSecret(SECRET, KEY, "abu-user:u1");
    const [v, id, iv, tag, ct] = enc.split(".");
    const flip = (s: string) => {
      const buf = Buffer.from(s, "base64url");
      buf[0] ^= 0x01;
      return buf.toString("base64url");
    };
    for (const bad of [[v, id, iv, tag, flip(ct)], [v, id, iv, flip(tag), ct], [v, id, flip(iv), tag, ct]]) {
      expect(() => decryptSecret(bad.join("."), [KEY], "abu-user:u1")).toThrow(MfaDecryptError);
    }
    expect(() => decryptSecret("noget-andet", [KEY], "abu-user:u1")).toThrow(MfaDecryptError);
  });

  it("er bundet til brugeren (associated data): kan ikke flyttes til en anden konto", () => {
    const enc = encryptSecret(SECRET, KEY, "abu-user:u1");
    expect(() => decryptSecret(enc, [KEY], "abu-user:u2")).toThrow(MfaDecryptError);
  });

  it("afviser ukendt nøgle og understøtter rotation med den forrige nøgle", () => {
    const old = deriveMfaKey("den-gamle-nøgle-0123456789-0123456789");
    const enc = encryptSecret(SECRET, old, "abu-user:u1");
    expect(() => decryptSecret(enc, [KEY], "abu-user:u1")).toThrow(/Ukendt nøgle/);
    const keys = mfaKeysFrom("den-nye-nøgle-0123456789-0123456789", "den-gamle-nøgle-0123456789-0123456789");
    expect(keys[0].id).not.toBe(old.id);
    expect(keys[1].id).toBe(old.id);
    expect(decryptSecret(enc, keys, "abu-user:u1")).toBe(SECRET);
    // Nye værdier krypteres altid med den aktuelle nøgle
    expect(keyIdOf(encryptSecret(SECRET, keys[0], "abu-user:u1"))).toBe(keys[0].id);
  });

  it("nøgle-id er stabilt for samme materiale; uden MFA_ENCRYPTION_KEY bruges udviklingsnøglen", () => {
    expect(deriveMfaKey("abc").id).toBe(deriveMfaKey("abc").id);
    expect(deriveMfaKey("abc").id).not.toBe(deriveMfaKey("abd").id);
    expect(mfaKeysFrom("", "")[0].id).toBe(deriveMfaKey(DEV_MFA_KEY_MATERIAL).id);
    expect(KEY.key).toHaveLength(32);
  });
});
