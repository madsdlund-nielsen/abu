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
 *
 * N-1 (docs/SECURITY-AUDIT-MFA-RLS.md): request-principalen huskes pr. request på Next.js' interne work store
 * (`workAsyncStorage`, ikke en offentlig API). Afhængigheden er gjort eksplicit og fail-closed:
 *  - `NEXT_WORK_STORE_PROBE` (nedenfor) og en test i db-context.test.ts fejler højt, hvis modulet flytter eller ændrer
 *    form ved en Next-opgradering (versionen er låst i package.json);
 *  - kører vi i Next-serveren (NEXT_RUNTIME), og en request har cookies men ingen work store, kastes DbContextError i
 *    stedet for stille at slå principalen op pr. forespørgsel;
 *  - skifter den slåede principal for en request midt i requesten uden et login/logud (fx fra en fuld session til
 *    anon), kastes DbContextError (`setRequestPrincipal` uden `transition`).
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

/**
 * Feature-probe af Next.js' interne work store (N-1). Låst til next@16 (package.json); testen
 * «Next.js' work store» i db-context.test.ts fejler ved en opgradering, der flytter eller ændrer API'et.
 */
export const NEXT_WORK_STORE_PROBE = {
  module: "next/dist/server/app-render/work-async-storage.external",
  ok: typeof (workAsyncStorage as { getStore?: unknown } | undefined)?.getStore === "function" && typeof (workAsyncStorage as { run?: unknown }).run === "function",
} as const;

interface RequestEntry {
  promise: Promise<Principal | null>;
  /** Principalen, som sessionsopslaget gav (eller et login/logud satte) – til vagten mod skift midt i requesten. */
  settled?: Principal;
}

/** Pr. request (Next.js' work store – samme objekt i server action, rendering og route handler). */
const requestMemo = new WeakMap<object, RequestEntry>();

function requestKey(): object | null {
  if (!NEXT_WORK_STORE_PROBE.ok) {
    throw new DbContextError(`RLS: Next.js' work store (${NEXT_WORK_STORE_PROBE.module}) findes ikke længere – request-principalen kan ikke huskes. Se db-context.ts (N-1).`);
  }
  return (workAsyncStorage.getStore() as object | undefined) ?? null;
}

let resolverOverride: Resolver | null = null;
/** Kun til tests. */
export function setRequestPrincipalResolver(fn: Resolver | null) {
  resolverOverride = fn;
}

async function defaultResolver(): Promise<Principal | null> {
  // Dovent: auth.ts importerer selv db.ts
  const { requestPrincipal } = await import("./auth");
  const p = await requestPrincipal();
  // I Next-serveren har en request (cookies findes) altid en work store. Mangler den, er huskningen brudt (fx efter en
  // Next-opgradering) – fejl højt i stedet for at slå principalen op pr. forespørgsel med risiko for skift (N-1).
  if (p && process.env.NEXT_RUNTIME && requestKey() === null) {
    throw new DbContextError("RLS: en request uden Next.js' work store – request-principalen kan ikke huskes (N-1).");
  }
  return p;
}

/** Principalen for den aktuelle forespørgsel: eksplicit kontekst, ellers requesten, ellers null. */
export async function currentPrincipal(): Promise<Principal | null> {
  const explicit = storage.getStore();
  if (explicit) return explicit;
  const key = requestKey();
  const hit = key ? requestMemo.get(key) : undefined;
  if (hit) return hit.promise;
  const p = (resolverOverride ?? defaultResolver)();
  if (key) requestMemo.set(key, { promise: p });
  return p;
}

const samePrincipal = (a: Principal, b: Principal) => a.userId === b.userId && a.role === b.role && (a.sessionId ?? null) === (b.sessionId ?? null);

/**
 * Sætter principalen for resten af requesten. `transition: true` = login, logud eller ny onboarding-cookie (principalen
 * skifter med vilje). Uden: sessionsopslaget (getSessionContext) – giver det en ANDEN principal end tidligere i samme
 * request (fx anon midt i en request for en fuld session), kastes DbContextError (N-1, fail closed). Uden for en
 * Next-request (tests, scripts) er det en no-op: der slås principalen op igen pr. forespørgsel.
 */
export function setRequestPrincipal(p: Principal, opts: { transition?: boolean } = {}): void {
  const key = requestKey();
  if (!key) return;
  const prev = requestMemo.get(key)?.settled;
  if (prev && !opts.transition && !samePrincipal(prev, p)) {
    throw new DbContextError(`RLS: request-principalen skiftede midt i requesten (${prev.role} → ${p.role}) uden login/logud (N-1).`);
  }
  requestMemo.set(key, { promise: Promise.resolve(p), settled: p });
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
  if (p) setRequestPrincipal({ ...p, ...patch }, { transition: true });
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
