import { randomInt } from "node:crypto";
import { sha256 } from "../tokens";

/**
 * Gendannelseskoder: 10 engangskoder à 10 tegn (50 bit) fra et alfabet uden forvekslelige tegn (0/O, 1/l/I),
 * vist som «xxxxx-xxxxx». Kun SHA-256 (med bruger-id som salt) gemmes. Brug markeres atomisk (`usedAt`), så en kode
 * kun virker én gang – også ved samtidige forsøg.
 */
export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const LENGTH = 10;

export function generateRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < n) {
    let raw = "";
    for (let i = 0; i < LENGTH; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
    codes.add(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return [...codes];
}

/** Små bogstaver, uden mellemrum og bindestreger. */
export function normalizeRecoveryCode(input: string): string {
  return input.toLowerCase().replace(/[\s-]/g, "");
}

export function looksLikeRecoveryCode(input: string): boolean {
  return new RegExp(`^[${ALPHABET}]{${LENGTH}}$`).test(normalizeRecoveryCode(input));
}

export function hashRecoveryCode(userId: string, code: string): string {
  return sha256(`abu-recovery:${userId}:${normalizeRecoveryCode(code)}`);
}

/** Tekstfil til «Download» (vises kun én gang). */
export function recoveryCodesText(email: string, codes: string[], now = new Date()): string {
  return [
    "Advisory Board Unlimited – gendannelseskoder til totrinsbekræftelse",
    `Konto: ${email}`,
    `Oprettet: ${now.toISOString().slice(0, 10)}`,
    "",
    "Hver kode kan bruges én gang, hvis du ikke har adgang til din godkendelses-app.",
    "Opbevar dem sikkert (fx i en adgangskodemanager). Nye koder ugyldiggør disse.",
    "",
    ...codes,
    "",
  ].join("\n");
}
