import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * Kryptering af TOTP-hemmeligheder i databasen: AES-256-GCM med en nøgle afledt (HKDF-SHA256) af MFA_ENCRYPTION_KEY.
 *
 * Format: `v1.<nøgle-id>.<iv>.<tag>.<chiffertekst>` (base64url). Nøgle-id'et er et kort fingeraftryk af den afledte
 * nøgle, så flere nøgler kan være i brug under rotation: sæt den nye i MFA_ENCRYPTION_KEY og den gamle i
 * MFA_ENCRYPTION_KEY_PREVIOUS; hemmeligheder krypteret med den gamle læses stadig og krypteres om ved næste brug.
 * Bruger-id'et er med som «associated data», så en chiffertekst ikke kan flyttes til en anden bruger.
 */
export interface MfaKey {
  id: string;
  key: Buffer;
}

const VERSION = "v1";
const HKDF_SALT = "abu-mfa-totp";
const HKDF_INFO = "aes-256-gcm/v1";

/** Kun lokal udvikling/test: fast nøgle, så seedede hemmeligheder kan læses efter genstart. Afvises i produktion (C-1). */
export const DEV_MFA_KEY_MATERIAL = "abu-dev-only-mfa-encryption-key-never-use-in-production";

export function deriveMfaKey(material: string): MfaKey {
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(material, "utf8"), HKDF_SALT, HKDF_INFO, 32));
  const id = createHmac("sha256", key).update("abu-mfa-key-id").digest("base64url").slice(0, 8);
  return { id, key };
}

export function encryptSecret(plain: string, key: MfaKey, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, key.id, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export class MfaDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MfaDecryptError";
  }
}

/** Nøgle-id'et i en krypteret værdi (til rotation), eller null ved et ukendt format. */
export function keyIdOf(enc: string): string | null {
  const parts = enc.split(".");
  return parts.length === 5 && parts[0] === VERSION ? parts[1] : null;
}

/** Dekrypterer med den nøgle, hvis id står i værdien. Kaster MfaDecryptError ved ukendt nøgle eller manipulation. */
export function decryptSecret(enc: string, keys: MfaKey[], aad: string): string {
  const parts = enc.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) throw new MfaDecryptError("Ukendt format");
  const [, id, iv, tag, ct] = parts;
  const key = keys.find((k) => k.id === id);
  if (!key) throw new MfaDecryptError("Ukendt nøgle (MFA_ENCRYPTION_KEY er skiftet uden MFA_ENCRYPTION_KEY_PREVIOUS?)");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new MfaDecryptError("Hemmeligheden kunne ikke dekrypteres (manipuleret eller forkert nøgle)");
  }
}

/** Nøglerne fra miljøet: den aktuelle først (bruges til kryptering), derefter evt. den forrige (kun dekryptering). */
export function mfaKeysFrom(current: string, previous: string): MfaKey[] {
  const keys = [deriveMfaKey(current || DEV_MFA_KEY_MATERIAL)];
  if (previous) keys.push(deriveMfaKey(previous));
  return keys;
}
