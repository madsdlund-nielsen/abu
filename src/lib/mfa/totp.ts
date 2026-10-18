import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) oven på HOTP (RFC 4226) med Nodes egen crypto – ingen tredjepartsbibliotek.
 * Parametre som Authy, Google Authenticator og 1Password forventer: HMAC-SHA1, 6 cifre, 30 sekunders trin.
 * Verifikation tillader ±1 trin (uret på telefonen må gå op til ca. 30 sekunder forkert) og afviser genbrug af et
 * trin, der allerede er brugt (replay), via `lastUsedStep`.
 */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_WINDOW = 1;
/** 160 bit, som anbefalet i RFC 4226 (afsnit 4, R6) */
export const TOTP_SECRET_BYTES = 20;
export const TOTP_ISSUER = "Advisory Board Unlimited";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Tåler små bogstaver, mellemrum, bindestreger og '='-udfyldning (manuel indtastning). Kaster ved ugyldige tegn. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Ugyldigt base32-tegn");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

export type HotpAlgorithm = "sha1" | "sha256" | "sha512";

/** HOTP (RFC 4226 afsnit 5.3): dynamisk trunkering af HMAC(K, C). */
export function hotp(key: Uint8Array, counter: number, digits = TOTP_DIGITS, algorithm: HotpAlgorithm = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** Tidstrinnet T = floor(unix-sekunder / 30). */
export function totpStep(at: Date | number, period = TOTP_PERIOD_SECONDS): number {
  const ms = typeof at === "number" ? at : at.getTime();
  return Math.floor(ms / 1000 / period);
}

export function totp(secretB32: string, at: Date | number = Date.now(), opts: { digits?: number; algorithm?: HotpAlgorithm; period?: number } = {}): string {
  return hotp(base32Decode(secretB32), totpStep(at, opts.period), opts.digits, opts.algorithm);
}

/** Kun cifre; mellemrum og bindestreger (fx «123 456») fjernes. */
export function normalizeTotpCode(input: string): string {
  return input.replace(/[\s-]/g, "");
}

function sameCode(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type TotpCheck = { ok: true; step: number } | { ok: false; reason: "format" | "invalid" | "replay" };

/**
 * Ren verifikation: koden skal matche et trin i [nu-1, nu+1] og være nyere end `lastUsedStep` (ellers replay).
 * Alle trin i vinduet sammenlignes, så svartiden ikke afslører, hvilket trin der matchede.
 */
export function verifyTotp(secretB32: string, input: string, now: Date | number, lastUsedStep: number | null = null, window = TOTP_WINDOW): TotpCheck {
  const code = normalizeTotpCode(input);
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) return { ok: false, reason: "format" };
  const key = base32Decode(secretB32);
  const current = totpStep(now);
  let matched: number | null = null;
  for (let d = -window; d <= window; d++) {
    if (sameCode(hotp(key, current + d), code) && matched === null) matched = current + d;
  }
  if (matched === null) return { ok: false, reason: "invalid" };
  if (lastUsedStep !== null && matched <= lastUsedStep) return { ok: false, reason: "replay" };
  return { ok: true, step: matched };
}

/** otpauth-URI til QR-koden (Key Uri Format): issuer og konto-e-mail, SHA1/6/30 eksplicit. */
export function otpauthUri(secretB32: string, accountEmail: string, issuer = TOTP_ISSUER): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountEmail)}`;
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, "%20")}`;
}

/** Hemmeligheden i grupper af 4 til manuel indtastning: «ABCD EFGH …». */
export function groupSecret(secretB32: string): string {
  return secretB32.replace(/(.{4})(?=.)/g, "$1 ");
}
