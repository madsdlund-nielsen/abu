import type { PrismaClient, Role } from "@prisma/client";
import { describe } from "vitest";
import type { Principal } from "@/lib/db-context";

/** `describeDb` springer over uden TEST_DATABASE_URL (enhedstests kræver ingen database). */
export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
export const describeDb = hasTestDb ? describe : describe.skip;

/** Unikt suffiks, så tests i parallelle filer ikke rører hinandens rækker. */
export const uid = (prefix = "t") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

let owner: PrismaClient | null = null;

/**
 * Forbindelse som databasens ejer (TEST_DATABASE_URL_OWNER = abu_owner) – KUN til oprydning, som appens rolle bevidst
 * ikke må (fx er AuditLog append-only for abu_app). Testene selv kører som abu_app (TEST_DATABASE_URL). Klienten har
 * IKKE RLS-udvidelsen: ejeren er undtaget i politikkerne (rls.app_is_system() = current_user er ejeren).
 */
export async function ownerDb(): Promise<PrismaClient> {
  if (!owner) {
    const [{ PrismaPg }, { PrismaClient }, { pgPoolConfig }] = await Promise.all([import("@prisma/adapter-pg"), import("@prisma/client"), import("@/lib/db-config")]);
    owner = new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(process.env.TEST_DATABASE_URL_OWNER || process.env.TEST_DATABASE_URL || "")) });
  }
  return owner;
}

/**
 * Testdata oprettes og ryddes op i systemkontekst (som seed), mens koden under test kører med den principal, appen
 * ville have i produktion (`asUser`, `asAnon` eller en rigtig session i cookie-krukken, src/test/request.ts).
 */
export async function asSystem<T>(fn: () => Promise<T> | T): Promise<T> {
  const { withSystemContext } = await import("@/lib/db-context");
  return withSystemContext("test.fixtures", fn);
}

/** Kører `fn` som en indlogget bruger (samme principal som getSessionContext giver for en fuld session). */
export async function asUser<T>(user: { id: string; role: Role }, fn: () => Promise<T> | T, extra: Partial<Principal> = {}): Promise<T> {
  const { runAsPrincipal } = await import("@/lib/db-context");
  return runAsPrincipal({ userId: user.id, role: user.role, ...extra }, fn);
}

/** Kører `fn` før login (evt. med en onboarding-cookies hash eller en MFA-ventende sessions id). */
export async function asAnon<T>(fn: () => Promise<T> | T, extra: Partial<Principal> = {}): Promise<T> {
  const { runAsPrincipal } = await import("@/lib/db-context");
  return runAsPrincipal({ userId: null, role: "anon", ...extra }, fn);
}

/** En rigtig bruger til tests (fx den administrator, der udfører en handling – audit-loggen kræver et gyldigt bruger-id). */
export async function createTestUser(role: Role, data: { name?: string; email?: string } = {}) {
  const { prisma } = await import("@/lib/db");
  return asSystem(() =>
    prisma.user.create({
      data: { role, name: data.name ?? `${role} Test`, email: data.email ?? `${uid(role.toLowerCase())}@test.dk`, ...(role === "ADVISOR" ? { advisorProfile: { create: {} } } : {}) },
    }),
  );
}

/**
 * Kontekst-sætningen, som appen sender (signeret, src/lib/db.ts), til rå SQL i tests – som en SQL-injektion i netop
 * den kontekst. `forged: true` = samme værdier UDEN gyldig signatur (det en angriber kan sætte selv).
 */
export async function contextStatement(ctx: Principal, opts: { forged?: boolean } = {}): Promise<[string, string[]]> {
  const [{ SET_CONTEXT_SQL }, { contextParams }] = await Promise.all([import("@/lib/db"), import("@/lib/db-context")]);
  const params = contextParams(ctx);
  if (opts.forged) params[4] = "";
  return [SET_CONTEXT_SQL, params];
}

export type RawQuery = (sql: string, params?: unknown[]) => Promise<import("pg").QueryResult>;

/**
 * Rå SQL som abu_app (TEST_DATABASE_URL) i én transaktion, der rulles tilbage – som en SQL-injektion i appens
 * forbindelse. `ctx` = appens signerede kontekst for principalen; null = ingen kontekst (angriberen sætter selv det, han
 * vil, med set_config). Hver sætning kører i et savepoint, så en forventet fejl ikke afbryder resten.
 */
export async function rawAsApp<T>(ctx: Principal | null, fn: (q: RawQuery) => Promise<T>): Promise<T> {
  const [{ default: pg }, { pgClientConfig }] = await Promise.all([import("pg"), import("@/lib/db-config")]);
  const client = new pg.Client(pgClientConfig(process.env.TEST_DATABASE_URL ?? ""));
  await client.connect();
  try {
    await client.query("BEGIN");
    if (ctx) {
      const [sql, params] = await contextStatement(ctx);
      await client.query(sql, params);
    }
    let n = 0;
    return await fn(async (sql, params) => {
      const sp = `s${n++}`;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        const r = await client.query(sql, params);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        return r;
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        throw e;
      }
    });
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

/** Sletter testbrugere (og deres rækker via kaskaden). */
export async function deleteTestUsers(ids: string[]) {
  const { prisma } = await import("@/lib/db");
  await asSystem(() => prisma.user.deleteMany({ where: { id: { in: ids } } }));
}
