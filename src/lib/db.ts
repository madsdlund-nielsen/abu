import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { DEV_DATABASE_URL, pgPoolConfig } from "./db-config";
import { contextParams, currentPrincipal, DbContextError, type Principal } from "./db-context";

export { DEV_DATABASE_URL };

/**
 * Prisma 7 forbinder via en driver-adapter (node-postgres) i stedet for den gamle Rust-motor. Poolstørrelse, TLS
 * (sslmode + DATABASE_SSL_CA) og timeouts kommer fra `pgPoolConfig` (src/lib/db-config.ts). I produktion skal
 * DATABASE_URL være sat og pege på app-rollen abu_app (prod-guard i env.ts + db-guard.ts).
 *
 * Row-Level Security (RLS fase 1–3, README «Row-Level Security»):
 *  - Hver operation kører i en transaktion, hvis første sætning er SET_CONTEXT_SQL med bundne parametre fra principalen
 *    (src/lib/db-context.ts) og en HMAC-signatur over dem (`app.ctx`, src/lib/db-context-sign.ts) – databasen afviser en
 *    kontekst uden gyldig signatur. `set_config(…, true)` er transaktionslokal – sikkert med pgBouncer i transaction-mode.
 *  - Model-operationer og `$queryRaw`/`$executeRaw` uden for en transaktion pakkes af query-udvidelsen i en
 *    batch-transaktion [set_config, forespørgslen]. Værdierne bindes, når operationen startes (i kalderens kontekst), så
 *    Prismas samling af `findUnique`-kald på tværs af requests (DataLoader) aldrig kan blande principaler.
 *  - Interaktive `$transaction(async (tx) => …)` sætter konteksten én gang som første sætning. `$transaction([…])`
 *    (array) afvises – brug en interaktiv transaktion (udvidelsen kan ikke sætte kontekst foran en array-transaktion).
 *  - Adapter-vagten nedenfor afviser enhver sætning uden for en transaktion og enhver transaktion, hvis første sætning
 *    ikke er SET_CONTEXT_SQL. Ingen forespørgsel kan altså slippe uden om konteksten.
 *  - Mangler principalen (intet login-forløb, ingen withSystemContext), kastes DbContextError; databasen ville
 *    alligevel afvise (politikkerne kræver `app.role`).
 */
export const SET_CONTEXT_SQL_PREFIX = "SELECT set_config('app.user_id'";

/** `app.ctx` er signaturen over de fire værdier (src/lib/db-context-sign.ts); databasen stoler kun på en gyldig. */
export const SET_CONTEXT_SQL =
  "SELECT set_config('app.user_id', $1, true), set_config('app.role', $2, true), set_config('app.session_id', $3, true), set_config('app.onboarding_token', $4, true), set_config('app.ctx', $5, true)";

const setContext = (db: { $executeRaw: PrismaClient["$executeRaw"] }, p: Principal) => {
  const [userId, role, sessionId, onboardingToken, ctx] = contextParams(p);
  return db.$executeRaw`SELECT set_config('app.user_id', ${userId}, true), set_config('app.role', ${role}, true), set_config('app.session_id', ${sessionId}, true), set_config('app.onboarding_token', ${onboardingToken}, true), set_config('app.ctx', ${ctx}, true)`;
};

async function requirePrincipal(what: string): Promise<Principal> {
  const p = await currentPrincipal();
  if (!p) {
    throw new DbContextError(
      `Ingen databasekontekst for ${what} (RLS). Forespørgsler skal køre i en request (session/anon) eller i withSystemContext(…).`,
    );
  }
  return p;
}

// --------------------------------------------------------------------------------------------- Adapter-vagt

type SqlQuery = { sql: string; args: unknown[] };
type Queryable = { queryRaw(q: SqlQuery): Promise<unknown>; executeRaw(q: SqlQuery): Promise<number> };

const TX_CONTROL = /^(COMMIT|ROLLBACK|SAVEPOINT |RELEASE SAVEPOINT |ROLLBACK TO SAVEPOINT )/;

function isContextStatement(q: SqlQuery): boolean {
  return q.sql.startsWith(SET_CONTEXT_SQL_PREFIX) && typeof q.args[1] === "string" && q.args[1] !== "";
}

/** Transaktionen må først køre andet end COMMIT/ROLLBACK, når konteksten er sat (første sætning). */
function guardTransaction<T extends object>(tx: T): T {
  let configured = false;
  const check = (q: SqlQuery) => {
    if (configured || TX_CONTROL.test(q.sql)) return;
    if (!isContextStatement(q)) throw new DbContextError("RLS: en transaktion skal starte med SET_CONTEXT_SQL (databasekonteksten).");
    configured = true;
  };
  return new Proxy(tx, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (prop === "queryRaw" || prop === "executeRaw") {
        return (q: SqlQuery) => {
          check(q);
          return (v as Queryable["queryRaw"]).call(target, q);
        };
      }
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

function guardAdapter<T extends object>(adapter: T): T {
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (prop === "queryRaw" || prop === "executeRaw") {
        return () => Promise.reject(new DbContextError("RLS: forespørgsler uden for en transaktion (uden databasekontekst) er ikke tilladt."));
      }
      if (prop === "startTransaction") {
        return async (...args: unknown[]) => guardTransaction(await (v as (...a: unknown[]) => Promise<object>).apply(target, args));
      }
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/** Adapter-vagten (eksporteret til src/lib/db-context.test.ts). */
export function guardAdapterFactory<T extends object>(factory: T): T {
  return new Proxy(factory, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (prop === "connect") return async () => guardAdapter(await (v as () => Promise<object>).call(target));
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

// --------------------------------------------------------------------------------------------- Udvidelse

const rlsExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: "rls-context",
    query: {
      async $allOperations({ args, query, model, operation, ...rest }) {
        // Ikke en del af Prismas offentlige API, men stabilt i Prisma 7 (applyQueryExtensions): den aktuelle transaktion
        const tx = (rest as { __internalParams?: { transaction?: { kind?: string } } }).__internalParams?.transaction;
        // Interaktiv transaktion: konteksten er sat som første sætning af $transaction-indpakningen
        if (tx?.kind === "itx") return query(args);
        if (tx?.kind === "batch") throw new DbContextError("RLS: prisma.$transaction([…]) understøttes ikke – brug en interaktiv transaktion.");
        const p = await requirePrincipal(`${model ?? ""}${model ? "." : ""}${operation}`);
        const [, result] = await client.$transaction([setContext(client, p), query(args)]);
        return result;
      },
    },
  }),
);

/**
 * Interaktive transaktioner: principalen bestemmes ved kaldet, og konteksten sættes som første sætning. Arrays afvises
 * (se ovenfor). Resten af klienten er uændret.
 */
function withRlsTransactions(ext: PrismaClient): PrismaClient {
  const $transaction = async (input: unknown, options?: Parameters<PrismaClient["$transaction"]>[1]) => {
    if (typeof input !== "function") throw new DbContextError("RLS: prisma.$transaction([…]) understøttes ikke – brug en interaktiv transaktion.");
    const p = await requirePrincipal("$transaction");
    return ext.$transaction(async (tx) => {
      await setContext(tx, p);
      return (input as (tx: Prisma.TransactionClient) => Promise<unknown>)(tx);
    }, options);
  };
  return new Proxy(ext, {
    get(target, prop, receiver) {
      if (prop === "$transaction") return $transaction;
      return Reflect.get(target, prop, receiver);
    },
  });
}

export function createPrismaClient(url = process.env.DATABASE_URL || DEV_DATABASE_URL): PrismaClient {
  const base = new PrismaClient({ adapter: guardAdapterFactory(new PrismaPg(pgPoolConfig(url))) });
  // Udvidelsen ændrer ikke API'et (kun en query-hook), så klienten præsenteres som en almindelig PrismaClient
  return withRlsTransactions(base.$extends(rlsExtension) as unknown as PrismaClient);
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
