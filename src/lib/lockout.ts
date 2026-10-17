import { prisma } from "./db";

/**
 * Login-spærring pr. konto (H-2), uafhængig af IP: 5 forkerte forsøg i træk → 15 min, 10 → 30 min, 15 → 60 min …
 * (fordobles for hver 5., højst 24 timer). Tælleren nulstilles ved korrekt login og ved nulstilling af adgangskoden,
 * og glemmes efter et døgn uden fejl.
 */
export const LOCK_THRESHOLD = 5;
export const BASE_LOCK_MS = 15 * 60_000;
export const MAX_LOCK_MS = 24 * 3_600_000;
export const FAILURE_MEMORY_MS = 24 * 3_600_000;

export interface LoginState {
  failedLoginCount: number;
  lastFailedLoginAt: Date | null;
  lockedUntil: Date | null;
}

export function lockDurationMs(failedCount: number): number {
  if (failedCount < LOCK_THRESHOLD || failedCount % LOCK_THRESHOLD !== 0) return 0;
  const level = failedCount / LOCK_THRESHOLD - 1;
  return Math.min(BASE_LOCK_MS * 2 ** level, MAX_LOCK_MS);
}

export function isLocked(state: Pick<LoginState, "lockedUntil">, now: Date): boolean {
  return Boolean(state.lockedUntil && state.lockedUntil > now);
}

/** Ny tilstand efter et forkert forsøg (ren funktion). */
export function afterFailedLogin(prev: LoginState, now: Date): LoginState & { lockedNow: boolean } {
  const fresh = !prev.lastFailedLoginAt || now.getTime() - prev.lastFailedLoginAt.getTime() > FAILURE_MEMORY_MS;
  const failedLoginCount = (fresh ? 0 : prev.failedLoginCount) + 1;
  const lock = lockDurationMs(failedLoginCount);
  return {
    failedLoginCount,
    lastFailedLoginAt: now,
    lockedUntil: lock ? new Date(now.getTime() + lock) : prev.lockedUntil,
    lockedNow: lock > 0,
  };
}

/** Registrerer et forkert forsøg atomisk (rækkelås, så samtidige forsøg ikke tabes). Returnerer om kontoen nu er spærret. */
export async function recordFailedLogin(userId: string, now = new Date()): Promise<{ lockedNow: boolean; lockedUntil: Date | null }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { failedLoginCount: true, lastFailedLoginAt: true, lockedUntil: true } });
    const next = afterFailedLogin(u, now);
    await tx.user.update({
      where: { id: userId },
      data: { failedLoginCount: next.failedLoginCount, lastFailedLoginAt: next.lastFailedLoginAt, lockedUntil: next.lockedUntil },
    });
    return { lockedNow: next.lockedNow, lockedUntil: next.lockedUntil };
  });
}

export async function resetLoginFailures(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null } });
}
