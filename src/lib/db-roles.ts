import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

/**
 * Hjælpere til `npm run db:roles` (scripts/db-roles.ts, prisma/roles.sql). Rene funktioner, så de kan testes.
 */

export const DB_ROLES = { owner: "abu_owner", app: "abu_app", jobs: "abu_jobs" } as const;

/** Adgangskoder skal kunne stå direkte i en postgresql://-URL (compose sætter dem ind) og være lange. */
export const DB_PASSWORD_PATTERN = /^[A-Za-z0-9._~-]{24,}$/;

export function dbPasswordProblem(name: string, value: string): string | null {
  if (DB_PASSWORD_PATTERN.test(value)) return null;
  return `${name} skal være mindst 24 tegn og kun bestå af A-Z, a-z, 0-9 og . _ ~ - (så den kan stå i en URL). Generér med: openssl rand -hex 32`;
}

const hmac = (key: Buffer, text: string) => createHmac("sha256", key).update(text).digest();

/**
 * SCRAM-SHA-256-verifikator i Postgres' format (`SCRAM-SHA-256$<iter>:<salt>$<StoredKey>:<ServerKey>`, RFC 5802/7677).
 * Postgres gemmer den uændret, så adgangskoden aldrig sendes eller logges i klartekst (som psql's \password).
 * Adgangskoden er ASCII (DB_PASSWORD_PATTERN), så SASLprep er identiteten.
 */
export function scramSha256Verifier(password: string, salt: Buffer = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const storedKey = createHash("sha256").update(hmac(salted, "Client Key")).digest();
  const serverKey = hmac(salted, "Server Key");
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}
