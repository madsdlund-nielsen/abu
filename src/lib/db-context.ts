import { AsyncLocalStorage } from "node:async_hooks";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { DB_CONTEXT_DEV_SECRET, deriveContextKey, signContext, type ContextKey } from "./db-context-sign";
import { getEnv, isProductionEnv } from "./env";

/**
 * Databasekontekst for Row-Level Security (RLS fase 1–3, docs/SECURITY-AUDIT-DELTA.md).
 *
 * Hver forespørgsel kører i en transaktion, der først sætter `app.user_id`, `app.role`, `app.session_id` og
 * `app.onboarding_token` med `set_config(…, true)` (src/lib/db.ts). Politikkerne i migrationen `…_rls_policies` læser dem
 * via `rls.app_user_id()`, `rls.app_role()` osv. Mangler konteksten, afviser både klienten (DbContextError) og politikkerne
 * (ingen `app.role` = ingen rækker).
 *
 * Hvor kommer principalen fra?
 *  1. En eksplicit kontekst i AsyncLocalStorage: `withSystemContext(reason, fn)` (jobs, webhooks, seed, auth-internt …)
 *     eller `runAsPrincipal` (sessionsopslaget i auth.ts og tests).
 *  2. Ellers requesten: sessionen (`getSessionContext` i auth.ts – det ene centrale sted), dvs. den indloggede bruger,
 *     ellers `anon` (før login, også med en MFA-ventende session). Resultatet huskes pr. request.
 *  3. Hverken eller (fx et script eller en timer uden kontekst): ingen principal → fejl (fail closed).
 *
 * Konteksten er signeret (`app.ctx`, src/lib/db-context-sign.ts): databasen stoler kun på værdier med en gyldig HMAC
 * fra nøglen i `DB_CONTEXT_SECRET`, så en SQL-injektion ikke kan forfalske `app.role = 'system'` eller en anden bruger.
 */

export type PrincipalRole = "ADMIN" | "ADVISOR" | "CUSTOMER" | "anon" | "system";

export interface Principal {
  /** Den indloggede bruger. null for anon og system. */
  userId: string | null;
  role: PrincipalRole;
  /** SHA-256 af session-cookien (også en MFA-ventende session, der kun må læse sin egen session og bruger). */
  sessionId?: string | null;
  /** SHA-256 af onboarding-cookien (`OnboardingSession.tokenHash`): giver adgang til egen tilmelding og dens lead. */
  onboardingToken?: string | null;
  /** Kun system: hvorfor (audit-venlig, fx "jobs.process"). */
  reason?: string;
}

export class DbContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbContextError";
  }
}

/** Årsager er grep-bare nøgler: «område.handling», fx "webhooks.payments" eller "auth.login". */
export const SYSTEM_REASON_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

const storage = new AsyncLocalStorage<Principal>();

/**
 * Kører `fn` med `app.role = 'system'` (alle rækker). KUN de steder, der står i allow-listen i
 * `src/lib/db-context.test.ts` (jobs, cron, webhooks, seed/create-admin, auth-internt før en session findes,
 * notifikationsmotoren og systemtabellerne). Hver brug har en årsag, der logges ved fejl.
 *
 * Bemærk: konteksten gælder nye forespørgsler via `prisma` – ikke en interaktiv transaktion, der allerede er startet
 * (den har sin egen kontekst fra starten).
 */
export async function withSystemContext<T>(reason: string, fn: () => Promise<T> | T): Promise<T> {
  if (!SYSTEM_REASON_PATTERN.test(reason)) throw new DbContextError(`Ugyldig årsag til systemkontekst: «${reason}»`);
  // `await` inde i run: PrismaPromises er dovne og skal udføres (then) inden for konteksten
  return storage.run({ userId: null, role: "system", reason }, async () => await fn());
}

/** En bestemt (ikke-system) principal – til sessionsopslaget i auth.ts og til tests. */
export async function runAsPrincipal<T>(principal: Principal, fn: () => Promise<T> | T): Promise<T> {
  if (principal.role === "system") throw new DbContextError("Brug withSystemContext til systemkontekst.");
  if (principal.role !== "anon" && !principal.userId) throw new DbContextError(`Rollen ${principal.role} kræver et bruger-id.`);
  return storage.run({ ...principal }, async () => await fn());
}

/** Den eksplicitte kontekst (AsyncLocalStorage), hvis der er en. */
export function explicitPrincipal(): Principal | undefined {
  return storage.getStore();
}

// --------------------------------------------------------------------------------------------- Request-principal

type Resolver = () => Promise<Principal | null>;

/** Pr. request (Next.js' work store – samme objekt i server action, rendering og route handler). */
const requestMemo = new WeakMap<object, Promise<Principal | null>>();

function requestKey(): object | null {
  try {
    return (workAsyncStorage.getStore() as object | undefined) ?? null;
  } catch {
    return null;
  }
}

let resolverOverride: Resolver | null = null;
/** Kun til tests. */
export function setRequestPrincipalResolver(fn: Resolver | null) {
  resolverOverride = fn;
}

async function defaultResolver(): Promise<Principal | null> {
  // Dovent: auth.ts importerer selv db.ts
  const { requestPrincipal } = await import("./auth");
  return requestPrincipal();
}

/** Principalen for den aktuelle forespørgsel: eksplicit kontekst, ellers requesten, ellers null. */
export async function currentPrincipal(): Promise<Principal | null> {
  const explicit = storage.getStore();
  if (explicit) return explicit;
  const key = requestKey();
  const hit = key ? requestMemo.get(key) : undefined;
  if (hit) return hit;
  const p = (resolverOverride ?? defaultResolver)();
  if (key) requestMemo.set(key, p);
  return p;
}

/**
 * Sætter principalen for resten af requesten (sessionen er slået op, en ny session er oprettet, eller brugeren er logget
 * ud). Uden for en Next-request (tests, scripts) er det en no-op: der slås principalen op igen pr. forespørgsel.
 */
export function setRequestPrincipal(p: Principal): void {
  const key = requestKey();
  if (key) requestMemo.set(key, Promise.resolve(p));
}

/**
 * Ændrer principalen for resten af requesten, fx når en ny onboarding-cookie er sat (createOnboardingSession). I en
 * eksplicit (ikke-system) kontekst ændres den kontekst; systemkontekst røres ikke.
 */
export async function updateRequestPrincipal(patch: Pick<Principal, "onboardingToken">): Promise<void> {
  const explicit = storage.getStore();
  if (explicit) {
    if (explicit.role !== "system") Object.assign(explicit, patch);
    return;
  }
  const p = await currentPrincipal();
  if (p) setRequestPrincipal({ ...p, ...patch });
}

/** Glemmer request-principalen (næste forespørgsel slår den op igen). */
export function clearRequestPrincipal(): void {
  const key = requestKey();
  if (key) requestMemo.delete(key);
}

// --------------------------------------------------------------------------------------------- Signeret kontekst

/** Nøglen til `app.ctx` (DB_CONTEXT_SECRET; uden for produktion den offentlige udviklingsnøgle). */
export function dbContextKey(): ContextKey {
  const secret = getEnv().DB_CONTEXT_SECRET;
  if (secret) return deriveContextKey(secret);
  if (isProductionEnv()) throw new DbContextError("DB_CONTEXT_SECRET mangler – databasekonteksten kan ikke signeres (kræves i produktion).");
  return deriveContextKey(DB_CONTEXT_DEV_SECRET);
}

/** Bundne parametre til `set_config` (rækkefølge som i SET_CONTEXT_SQL i db.ts): de fire værdier og signaturen. */
export function contextParams(p: Principal, key: ContextKey = dbContextKey()): [string, string, string, string, string] {
  const values = [p.userId ?? "", p.role, p.sessionId ?? "", p.onboardingToken ?? ""] as const;
  return [...values, signContext(values, key)];
}
