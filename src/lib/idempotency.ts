import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { withSystemContext } from "./db-context";
import { sha256 } from "./tokens";

/**
 * Server-side idempotens (QA #1): formularen sender en tilfældig nøgle (genereret, når siden vises). Første kald med
 * nøglen udfører handlingen og gemmer resultatet; gentagne kald (dobbeltklik, genindsendelse, netværksfejl) får det samme
 * resultat i stedet for en fejl. Nøglen er bundet til brugeren og handlingen.
 *
 * RLS: IdempotencyKey er en systemtabel – nøglerne læses/skrives i systemkontekst («idempotency.key»), mens selve
 * handlingen (`fn`) kører i kalderens egen kontekst (kunden, admin …).
 */
const keys = <T>(fn: () => Promise<T>) => withSystemContext("idempotency.key", fn);
export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;
const WAIT_MS = 20_000;
const POLL_MS = 150;

export class IdempotencyInFlightError extends Error {
  constructor() {
    super("Handlingen behandles allerede. Opdater siden om lidt.");
  }
}

/** Gyldig klientnøgle: UUID eller 16-128 tegn base64url. */
export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(key.replace(/-/g, "_"));
}

export function idempotencyId(userId: string, scope: string, key: string): string {
  return sha256(`${userId}\u0000${scope}\u0000${key}`);
}

export async function withIdempotency<T extends Prisma.InputJsonValue>(
  opts: { userId: string; scope: string; key: unknown; ttlMs?: number },
  fn: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  if (!isValidIdempotencyKey(opts.key)) return { result: await fn(), replayed: false };
  const id = idempotencyId(opts.userId, opts.scope, opts.key);
  const expiresAt = new Date(Date.now() + (opts.ttlMs ?? IDEMPOTENCY_TTL_MS));
  const claimed = await keys(() =>
    prisma.idempotencyKey
      .create({ data: { id, userId: opts.userId, scope: opts.scope, expiresAt }, select: { id: true } })
      .then(() => true)
      .catch((e: { code?: string }) => {
        if (e.code === "P2002") return false;
        throw e;
      }),
  );

  if (!claimed) {
    // Et andet kald med samme nøgle er i gang eller færdigt: vent på dets resultat
    const until = Date.now() + WAIT_MS;
    for (;;) {
      const row = await keys(() => prisma.idempotencyKey.findUnique({ where: { id } }));
      if (!row) return withIdempotency(opts, fn); // det første kald fejlede og frigav nøglen
      if (row.result !== null) return { result: row.result as T, replayed: true };
      if (Date.now() > until) throw new IdempotencyInFlightError();
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  try {
    const result = await fn();
    await keys(() => prisma.idempotencyKey.update({ where: { id }, data: { result }, select: { id: true } }));
    return { result, replayed: false };
  } catch (e) {
    // Uventet fejl: frigiv nøglen, så et nyt forsøg kan køre
    await keys(() => prisma.idempotencyKey.delete({ where: { id } })).catch(() => {});
    throw e;
  }
}

/** Oprydning (jobkøen, systemkontekst). */
export async function cleanupIdempotencyKeys(now = new Date()): Promise<number> {
  return (await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } })).count;
}
