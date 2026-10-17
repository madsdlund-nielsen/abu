import { UNKNOWN_IP } from "./client-ip";
import { prisma } from "./db";
import { isProductionEnv } from "./env";
import { sha256 } from "./tokens";

/**
 * Rate limits i et fælles lager (H-2/L-2). Standard er Postgres-tabellen `RateLimit`, så grænserne overlever genstart og
 * deles mellem flere instanser. Nøgler gemmes som SHA-256 (ingen e-mails eller IP'er i klartekst).
 */
export interface RateLimitStore {
  /** Tæller ét forsøg og returnerer antallet i det aktuelle vindue. */
  hit(key: string, windowMs: number, now: Date): Promise<{ count: number; resetAt: Date }>;
  reset(key: string): Promise<void>;
}

export class PostgresRateLimitStore implements RateLimitStore {
  async hit(key: string, windowMs: number, now: Date) {
    const resetAt = new Date(now.getTime() + windowMs);
    // Atomisk: opret, tæl op eller start et nyt vindue i én sætning (ingen race mellem instanser)
    const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
      INSERT INTO "RateLimit" ("key", "count", "resetAt") VALUES (${key}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimit"."resetAt" <= ${now} THEN 1 ELSE "RateLimit"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimit"."resetAt" <= ${now} THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
      RETURNING "count", "resetAt"`;
    return { count: Number(rows[0].count), resetAt: rows[0].resetAt };
  }

  async reset(key: string) {
    await prisma.rateLimit.deleteMany({ where: { key } });
  }
}

/** Til enhedstests (og som reference for semantikken). */
export class MemoryRateLimitStore implements RateLimitStore {
  private map = new Map<string, { count: number; resetAt: Date }>();
  async hit(key: string, windowMs: number, now: Date) {
    const e = this.map.get(key);
    const next = !e || e.resetAt <= now ? { count: 1, resetAt: new Date(now.getTime() + windowMs) } : { count: e.count + 1, resetAt: e.resetAt };
    this.map.set(key, next);
    return { ...next };
  }
  async reset(key: string) {
    this.map.delete(key);
  }
}

let store: RateLimitStore = new PostgresRateLimitStore();
/** Kun til tests. */
export function setRateLimitStore(s: RateLimitStore) {
  store = s;
}

const storeKey = (key: string) => sha256(`rl:${key}`);

/** true = tilladt. Tæller altid forsøget (også når grænsen er nået). */
export async function rateLimit(key: string, max = 8, windowMs = 15 * 60_000, now = new Date()): Promise<boolean> {
  const { count } = await store.hit(storeKey(key), windowMs, now);
  return count <= max;
}

export async function clearRateLimit(key: string): Promise<void> {
  await store.reset(storeKey(key));
}

/** Sletter udløbne rækker (jobkøen, dagligt). */
export async function cleanupRateLimits(now = new Date()): Promise<number> {
  const r = await prisma.rateLimit.deleteMany({ where: { resetAt: { lt: new Date(now.getTime() - 3_600_000) } } });
  return r.count;
}

/**
 * Grænse pr. klient-IP. Kan IP'en ikke afgøres (ingen betroet proxy), springes grænsen over uden for produktion (lokal
 * udvikling); i produktion deler alle sådanne kald én fælles kvote.
 */
export async function rateLimitIp(prefix: string, ip: string, max: number, windowMs = 15 * 60_000): Promise<boolean> {
  if (ip === UNKNOWN_IP && !isProductionEnv()) return true;
  return rateLimit(`${prefix}:${ip}`, max, windowMs);
}
