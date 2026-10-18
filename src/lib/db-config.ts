import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";
import type { ClientConfig, PoolConfig } from "pg";

/**
 * Databaseforbindelsen (RLS fase 0, docs/SECURITY-AUDIT-DELTA.md): pool, TLS og timeouts. Én kilde for Prisma-klienten,
 * opstartstjekket (db-guard) og `npm run db:roles`. Ren konfiguration – ingen forbindelse oprettes her.
 *
 * Roller (prisma/roles.sql): appen forbinder som `abu_app` (kun DML), migrationer/seed/create-admin som ejeren `abu_owner`.
 */

/** Lokal udvikling uden DATABASE_URL: app-rollen på localhost (adgangskode fra .env; se README). */
export const DEV_DATABASE_URL = "postgresql://abu_app@localhost:5432/abu";

/** Værtsnavnet på Postgres-servicen i docker-compose (internt bridge-netværk på samme maskine, ingen publiceret port). */
export const COMPOSE_DB_HOST = "postgres";

export const SSL_MODES = ["disable", "require", "verify-ca", "verify-full"] as const;
export type SslMode = (typeof SSL_MODES)[number];

/** TLS-parametre i URL'en, som vi selv fortolker (node-postgres' egen fortolkning afviger fra libpq). */
const URL_SSL_PARAMS = ["sslmode", "sslrootcert", "sslcert", "sslkey", "ssl", "uselibpqcompat", "sslnegotiation"];

/** Standard for appens rolle (sættes også på rollen i prisma/roles.sql, så de gælder for alle klienter). */
export const APP_DB_TIMEOUTS = {
  /** Ingen enkelt SQL-sætning må køre længere end 15 s (samme loft som de interaktive transaktioner). */
  statement_timeout: 15_000,
  /** Vent højst 10 s på en lås (også advisory locks), før sætningen afbrydes. */
  lock_timeout: 10_000,
  /** En transaktion, der står stille i 30 s, afbrydes af serveren (bagstopper lækkede forbindelser). */
  idle_in_transaction_session_timeout: 30_000,
} as const;

export const DB_POOL_MAX_DEFAULT = 10;

export class DbUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbUrlError";
  }
}

export interface DbUrlInfo {
  /** Værtsnavn, IP eller socket-mappe (starter med /). */
  host: string;
  user: string;
  password: string;
  database: string;
  /** Unix-socket (ingen netværkstrafik). */
  socket: boolean;
  /** null = ikke angivet (betyder "disable" for appen). */
  sslmode: SslMode | null;
  sslrootcert: string | null;
  /** URL'en uden TLS-parametre (dem sætter vi selv, se `sslOptions`). */
  connectionString: string;
}

/** Fortolker en postgresql://-URL. Kaster DbUrlError med en dansk besked (uden adgangskoden). */
export function parseDbUrl(url: string): DbUrlInfo {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new DbUrlError("DATABASE_URL er ikke en gyldig postgresql://-URL (brug ?host=/sti for en Unix-socket).");
  }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") throw new DbUrlError("DATABASE_URL skal starte med postgresql://.");
  const mode = u.searchParams.get("sslmode");
  if (mode !== null && !(SSL_MODES as readonly string[]).includes(mode)) {
    throw new DbUrlError(`sslmode=${mode} understøttes ikke (brug ${SSL_MODES.join(", ")}).`);
  }
  const sslrootcert = u.searchParams.get("sslrootcert");
  const host = u.searchParams.get("host") ?? decodeURIComponent(u.hostname).replace(/^\[(.*)\]$/, "$1");
  for (const p of URL_SSL_PARAMS) u.searchParams.delete(p);
  return {
    host: host || "localhost",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    socket: host.startsWith("/"),
    sslmode: mode as SslMode | null,
    sslrootcert,
    connectionString: u.toString(),
  };
}

/** Unix-socket eller loopback: trafikken forlader aldrig maskinen. */
export function isLoopbackDbHost(host: string): boolean {
  return host.startsWith("/") || host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/**
 * Må forbindelsen køre uden TLS i produktion? Kun en lokal socket/loopback eller compose-databasen `postgres`, som appen
 * når over Dockers interne bridge-netværk på samme maskine (porten publiceres ikke). Alle andre værter kræver TLS.
 */
export function tlsExemptDbHost(host: string): boolean {
  return isLoopbackDbHost(host) || host === COMPOSE_DB_HOST;
}

/**
 * TLS-indstillinger med libpq-semantik:
 *  - disable (eller intet): ingen TLS.
 *  - require: krypteret, men certifikatet tjekkes ikke – medmindre en CA er angivet (så som verify-ca, som libpq).
 *  - verify-ca: certifikatet skal være udstedt af CA'en (værtsnavnet tjekkes ikke).
 *  - verify-full: CA + værtsnavn (anbefalet). Uden DATABASE_SSL_CA bruges systemets rodcertifikater.
 */
export function sslOptions(mode: SslMode | null, ca: string | undefined): false | ConnectionOptions {
  const skipHostname = { checkServerIdentity: () => undefined };
  switch (mode ?? "disable") {
    case "disable":
      return false;
    case "require":
      return ca ? { ca, rejectUnauthorized: true, ...skipHostname } : { rejectUnauthorized: false };
    case "verify-ca":
      return { ...(ca ? { ca } : {}), rejectUnauthorized: true, ...skipHostname };
    default:
      return { ...(ca ? { ca } : {}), rejectUnauthorized: true };
  }
}

function poolMax(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : DB_POOL_MAX_DEFAULT;
}

type RawEnv = Record<string, string | undefined>;

/**
 * Én forbindelse til node-postgres (opstartstjek og scripts) med TLS og appens timeouts. CA-filen læses fra
 * DATABASE_SSL_CA (eller `sslrootcert` i URL'en).
 */
export function pgClientConfig(url: string, env: RawEnv = process.env, readFile: (path: string) => string = (p) => readFileSync(p, "utf8")): ClientConfig {
  const info = parseDbUrl(url);
  const caFile = env.DATABASE_SSL_CA || info.sslrootcert || "";
  return {
    connectionString: info.connectionString,
    ssl: sslOptions(info.sslmode, caFile ? readFile(caFile) : undefined),
    connectionTimeoutMillis: 10_000,
    application_name: "abu",
    ...APP_DB_TIMEOUTS,
  };
}

/** Prisma-adapterens pool: som `pgClientConfig` + poolstørrelse (DATABASE_POOL_MAX, standard 10 pr. proces). */
export function pgPoolConfig(url: string, env: RawEnv = process.env, readFile?: (path: string) => string): PoolConfig {
  return { ...pgClientConfig(url, env, readFile), max: poolMax(env.DATABASE_POOL_MAX), idleTimeoutMillis: 30_000 };
}
