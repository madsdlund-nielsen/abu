import { UNKNOWN_IP } from "./client-ip";
import { prisma } from "./db";
import { withSystemContext } from "./db-context";
import { isProductionEnv } from "./env";
import { sha256 } from "./tokens";

/**
 * Rate limits i et fælles lager (H-2/L-2). Standard er Postgres-tabellen `RateLimit`, så grænserne overlever genstart og
 * deles mellem flere instanser. Nøgler gemmes som SHA-256 (ingen e-mails eller IP'er i klartekst).
 */
export interface RateLimitStore {
  /** Tæller ét forsøg og returnerer antallet i det aktuelle vindue (nøglen i klartekst, «spand:emne»). */
  hit(key: string, windowMs: number, now: Date): Promise<{ count: number; resetAt: Date }>;
  reset(key: string): Promise<void>;
}

/**
 * RLS (R-2): RateLimit er en systemtabel. Tællingen går gennem SECURITY DEFINER-funktionerne `rls.rate_limit_hit`/
 * `rls.rate_limit_reset` (migrationen 20261021093000_rate_limit_scope). Databasen afleder selv nøglen af (spand, emne) –
 * samme SHA-256 som `storeKey` – og bruger sin egen tid, så en kalder hverken kan vælge en andens nøgle frit eller
 * nulstille et vindue med et falsk tidspunkt:
 *  - spande, hvis emne er kalderen selv (`SELF_BUCKETS`: bruger-id, egen tilmelding), tælles i kalderens kontekst –
 *    databasen afviser et emne, der ikke er kalderen;
 *  - spande uden en identitet i databasen (klient-IP, e-mail før login, afmeldingstoken, CVR-budget, alarmer) tælles i
 *    systemkonteksten («ratelimit.count») – en SQL-injektion i en request kan ikke nå dem;
 *  - nulstilling kun i systemkonteksten («ratelimit.reset»).
 */
export const SELF_BUCKETS = ["mfa-user", "pw-change", "admin-invite", "admin-manage", "onb-cvr-s"] as const;

/** «spand:emne» → [spand, emne] (emnet kan selv indeholde kolon, fx en IPv6-adresse). */
export function splitKey(key: string): [string, string] {
  const i = key.indexOf(":");
  return i < 0 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)];
}

export class PostgresRateLimitStore implements RateLimitStore {
  /** `now` bruges ikke: databasens tid er afgørende (R-2). */
  async hit(key: string, windowMs: number) {
    const [bucket, subject] = splitKey(key);
    const seconds = Math.max(1, Math.ceil(windowMs / 1000));
    // Atomisk: opret, tæl op eller start et nyt vindue i én sætning (ingen race mellem instanser)
    const run = () => prisma.$queryRaw<{ hits: number; reset_until: Date }[]>`
      SELECT hits, reset_until FROM rls.rate_limit_hit(${bucket}, ${subject}, ${seconds}::integer)`;
    const rows = (SELF_BUCKETS as readonly string[]).includes(bucket) ? await run() : await withSystemContext("ratelimit.count", run);
    return { count: Number(rows[0].hits), resetAt: rows[0].reset_until };
  }

  async reset(key: string) {
    const [bucket, subject] = splitKey(key);
    await withSystemContext("ratelimit.reset", () => prisma.$executeRaw`SELECT rls.rate_limit_reset(${bucket}, ${subject})`);
  }
}

/** Til enhedstests (og som reference for semantikken). */
export class MemoryRateLimitStore implements RateLimitStore {
  private map = new Map<string, { count: number; resetAt: Date }>();
  async hit(rawKey: string, windowMs: number, now: Date) {
    const key = storeKey(rawKey);
    const e = this.map.get(key);
    const next = !e || e.resetAt <= now ? { count: 1, resetAt: new Date(now.getTime() + windowMs) } : { count: e.count + 1, resetAt: e.resetAt };
    this.map.set(key, next);
    return { ...next };
  }
  async reset(key: string) {
    this.map.delete(storeKey(key));
  }
}

let store: RateLimitStore = new PostgresRateLimitStore();
/** Kun til tests. */
export function setRateLimitStore(s: RateLimitStore) {
  store = s;
}

/** Nøglen, som den gemmes i lageret (SHA-256). */
export const storeKey = (key: string) => sha256(`rl:${key}`);

/** true = tilladt. Tæller altid forsøget (også når grænsen er nået). */
export async function rateLimit(key: string, max = 8, windowMs = 15 * 60_000, now = new Date()): Promise<boolean> {
  const { count } = await store.hit(key, windowMs, now);
  return count <= max;
}

export async function clearRateLimit(key: string): Promise<void> {
  await store.reset(key);
}

/** Sletter udløbne rækker (jobkøen, dagligt – systemkontekst). */
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
