import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { withSystemContext } from "../db-context";
import { getEnv } from "../env";
import { rateLimit } from "../rate-limit";
import { TZ } from "../time";
import { CvrapiCvr } from "./cvrapi";
import { MockCvr } from "./mock";
import type { CvrLookupResult, CvrProvider } from "./types";
import { isValidCvr, normalizeCvr } from "./validate";
import { VirkCvr } from "./virk";

export type { CompanyInfo, CvrLookupResult } from "./types";
export { isValidCvr, normalizeCvr } from "./validate";

let provider: CvrProvider | null = null;
/** Kun til tests. */
export function setCvrProvider(p: CvrProvider | null) {
  provider = p;
}
export function getCvrProvider(): CvrProvider {
  if (!provider) {
    const p = getEnv().CVR_PROVIDER;
    provider = p === "virk" ? new VirkCvr() : p === "cvrapi" ? new CvrapiCvr() : new MockCvr();
  }
  return provider;
}

const FOUND_TTL_MS = 24 * 3_600_000;
/** "Ikke fundet" caches kortere (et nyt CVR-nummer kan dukke op), men caches – ellers kan kvoten drænes med opdigtede numre. */
const NOT_FOUND_TTL_MS = 6 * 3_600_000;

export function cacheTtlMs(result: CvrLookupResult): number | null {
  if (result.kind === "error") return null;
  return result.kind === "not_found" ? NOT_FOUND_TTL_MS : FOUND_TTL_MS;
}

/** Dagens nøgle for det globale budget (dansk dato). */
export function budgetKey(now: Date): string {
  return `cvr-budget:${new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(now)}`;
}

export const BUDGET_EXHAUSTED: CvrLookupResult = { kind: "error", message: "Dagens kvote for CVR-opslag er brugt.", quota: true };

/**
 * Opslag med fælles cache i databasen (24 t; "ikke fundet" 6 t) og et globalt dagsbudget for eksterne kald (M-4). Er
 * budgettet brugt, svares der som ved opbrugt kvote, så kunden kan fortsætte med manuel indtastning.
 * RLS: CvrLookupCache er en systemtabel (offentlige registerdata, men fælles for alle) – cachen læses og skrives i
 * systemkontekst, også når opslaget kommer fra onboarding før login.
 */
export async function lookupCvr(input: string, now = new Date()): Promise<CvrLookupResult> {
  const cvr = normalizeCvr(input);
  if (!isValidCvr(cvr)) return { kind: "error", message: "Ugyldigt CVR-nummer." };
  const hit = await withSystemContext("cvr.cache", () => prisma.cvrLookupCache.findUnique({ where: { cvr } }));
  if (hit && hit.expiresAt > now) return hit.result as unknown as CvrLookupResult;

  const p = getCvrProvider();
  if (p.name !== "mock" && !(await rateLimit(budgetKey(now), getEnv().CVR_DAILY_BUDGET, 26 * 3_600_000, now))) {
    console.warn("[cvr] dagsbudgettet for eksterne opslag er brugt");
    return BUDGET_EXHAUSTED;
  }
  const result = await p.lookup(cvr);
  const ttl = cacheTtlMs(result);
  if (ttl) {
    const data = { result: result as unknown as Prisma.InputJsonValue, expiresAt: new Date(now.getTime() + ttl) };
    await withSystemContext("cvr.cache", () => prisma.cvrLookupCache.upsert({ where: { cvr }, update: data, create: { cvr, ...data }, select: { cvr: true } }));
  }
  return result;
}

/** Sletter udløbne cache-rækker (jobkøen). */
export async function cleanupCvrCache(now = new Date()): Promise<number> {
  return (await prisma.cvrLookupCache.deleteMany({ where: { expiresAt: { lt: now } } })).count;
}
