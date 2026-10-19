import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, groupSecret, hotp, otpauthUri, totp, totpStep, verifyTotp } from "./totp";

const ascii = (s: string) => Buffer.from(s, "ascii");
// RFC 6238 appendix B: nøglerne er ASCII "1234567890" gentaget til 20/32/64 bytes
const SEED_SHA1 = ascii("12345678901234567890");
const SEED_SHA256 = ascii("12345678901234567890123456789012");
const SEED_SHA512 = ascii("1234567890123456789012345678901234567890123456789012345678901234");

describe("HOTP (RFC 4226 appendix D)", () => {
  it("giver de officielle testværdier for tæller 0-9", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, counter) => expect(hotp(SEED_SHA1, counter)).toBe(code));
  });
});

describe("TOTP (RFC 6238 appendix B, 8 cifre)", () => {
  const vectors: [number, string, string, string][] = [
    // [tid i sekunder, SHA1, SHA256, SHA512]
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];
  it.each(vectors)("t=%i", (t, sha1, sha256, sha512) => {
    const step = totpStep(t * 1000);
    expect(hotp(SEED_SHA1, step, 8, "sha1")).toBe(sha1);
    expect(hotp(SEED_SHA256, step, 8, "sha256")).toBe(sha256);
    expect(hotp(SEED_SHA512, step, 8, "sha512")).toBe(sha512);
  });
  it("6-cifret SHA1 via base32-hemmeligheden (sådan som apps bruger den)", () => {
    const b32 = base32Encode(SEED_SHA1);
    expect(b32).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totp(b32, 59_000)).toBe("287082");
    expect(totp(b32, 1111111109_000)).toBe("081804");
  });
});

describe("base32 (RFC 4648)", () => {
  it("koder og afkoder testvektorerne", () => {
    const v: [string, string][] = [["", ""], ["f", "MY"], ["fo", "MZXQ"], ["foo", "MZXW6"], ["foob", "MZXW6YQ"], ["fooba", "MZXW6YTB"], ["foobar", "MZXW6YTBOI"]];
    for (const [plain, enc] of v) {
      expect(base32Encode(ascii(plain))).toBe(enc);
      expect(base32Decode(enc).toString("ascii")).toBe(plain);
    }
  });
  it("tåler mellemrum, små bogstaver og udfyldning, men afviser ugyldige tegn", () => {
    expect(base32Decode("mzxw 6ytb oi==").toString("ascii")).toBe("foobar");
    expect(() => base32Decode("MZXW1")).toThrow();
  });
  it("nye hemmeligheder er 160 bit (32 base32-tegn) og tilfældige", () => {
    const a = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(a)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(a);
    expect(groupSecret("ABCDEFGHIJKL")).toBe("ABCD EFGH IJKL");
  });
});

describe("verifikation: vindue ±1 trin og replay", () => {
  const secret = base32Encode(SEED_SHA1);
  const now = 1_700_000_015_000; // midt i et trin
  const step = totpStep(now);
  const codeAt = (s: number) => totp(secret, s * 30_000);

  it("accepterer det aktuelle trin og ét trin før/efter (urforskydning)", () => {
    expect(verifyTotp(secret, codeAt(step), now)).toEqual({ ok: true, step });
    expect(verifyTotp(secret, codeAt(step - 1), now)).toEqual({ ok: true, step: step - 1 });
    expect(verifyTotp(secret, codeAt(step + 1), now)).toEqual({ ok: true, step: step + 1 });
  });
  it("afviser koder to trin væk", () => {
    expect(verifyTotp(secret, codeAt(step - 2), now)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyTotp(secret, codeAt(step + 2), now)).toEqual({ ok: false, reason: "invalid" });
  });
  it("afviser genbrug af et brugt trin og ældre trin (replay)", () => {
    expect(verifyTotp(secret, codeAt(step), now, step)).toEqual({ ok: false, reason: "replay" });
    expect(verifyTotp(secret, codeAt(step - 1), now, step)).toEqual({ ok: false, reason: "replay" });
    // Næste trin er stadig gyldigt
    expect(verifyTotp(secret, codeAt(step + 1), now, step)).toEqual({ ok: true, step: step + 1 });
  });
  it("tjekker formatet (6 cifre; mellemrum tilladt)", () => {
    const c = codeAt(step);
    expect(verifyTotp(secret, `${c.slice(0, 3)} ${c.slice(3)}`, now)).toMatchObject({ ok: true });
    expect(verifyTotp(secret, "12345", now)).toEqual({ ok: false, reason: "format" });
    expect(verifyTotp(secret, "abcdef", now)).toEqual({ ok: false, reason: "format" });
    expect(verifyTotp(secret, "", now)).toEqual({ ok: false, reason: "format" });
  });
});

describe("otpauth-URI", () => {
  it("har issuer, konto-e-mail og SHA1/6/30", () => {
    const uri = otpauthUri("JBSWY3DPEHPK3PXP", "mads@qlim8.com");
    expect(uri.startsWith("otpauth://totp/Advisory%20Board%20Unlimited:mads%40qlim8.com?")).toBe(true);
    const q = new URL(uri).searchParams;
    expect(q.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(q.get("issuer")).toBe("Advisory Board Unlimited");
    expect(q.get("algorithm")).toBe("SHA1");
    expect(q.get("digits")).toBe("6");
    expect(q.get("period")).toBe("30");
  });
});
