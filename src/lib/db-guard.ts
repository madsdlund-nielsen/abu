import pg from "pg";
import { pgClientConfig } from "./db-config";
import { EnvConfigError, type AppEnv } from "./env";

/**
 * Opstartstjek af databaserollen (RLS fase 0, del af C-1-guarden): i produktion må appen ikke forbinde som superbruger,
 * som ejeren af tabellerne/databasen, med BYPASSRLS/CREATEROLE/CREATEDB eller med ret til at oprette objekter (DDL).
 * Så ville fremtidige RLS-politikker ikke gælde for appen, og et SQL-injektions- eller RCE-hul ville kunne ændre skemaet.
 * Tjekket er én billig forespørgsel ved opstart; rollenavnet logges (aldrig URL eller adgangskode).
 */

export interface DbRoleFacts {
  user: string;
  superuser: boolean;
  bypassRls: boolean;
  createRole: boolean;
  createDb: boolean;
  /** Antal objekter i schema public, som rollen ejer (direkte eller via medlemskab af ejerrollen). */
  ownedObjects: number;
  /** Ejer (eller er medlem af ejeren af) den kendte tabel "User". null = tabellen findes ikke. */
  ownsUserTable: boolean | null;
  ownsDatabase: boolean;
  /** Kan oprette objekter i schema public (DDL). */
  schemaCreate: boolean;
  /** Er forbindelsen krypteret (TLS)? */
  ssl: boolean;
}

export const DB_ROLE_FACTS_SQL = `
SELECT r.rolname AS "user",
       r.rolsuper AS "superuser",
       r.rolbypassrls AS "bypassRls",
       r.rolcreaterole AS "createRole",
       r.rolcreatedb AS "createDb",
       (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND pg_has_role(r.oid, c.relowner, 'MEMBER')) AS "ownedObjects",
       pg_has_role(r.oid, (SELECT relowner FROM pg_class WHERE oid = to_regclass('public."User"')), 'MEMBER') AS "ownsUserTable",
       pg_has_role(r.oid, (SELECT datdba FROM pg_database WHERE datname = current_database()), 'MEMBER') AS "ownsDatabase",
       has_schema_privilege(r.oid, 'public', 'CREATE') AS "schemaCreate",
       coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS "ssl"
  FROM pg_roles r
 WHERE r.rolname = current_user`;

/** Hvad er galt med rollen, appen kører som? Tom liste = OK (ren funktion). */
export function dbRoleProblems(f: DbRoleFacts): string[] {
  const p: string[] = [];
  const who = `DATABASE_URL forbinder som «${f.user}», der`;
  if (f.superuser) p.push(`${who} er superbruger. Brug app-rollen abu_app (npm run db:roles).`);
  if (f.bypassRls) p.push(`${who} har BYPASSRLS (RLS-politikker ville ikke gælde).`);
  if (f.createRole) p.push(`${who} har CREATEROLE.`);
  if (f.createDb) p.push(`${who} har CREATEDB.`);
  if (f.ownsUserTable === null) p.push(`Tabellen "User" findes ikke for «${f.user}» – er migrationerne kørt (som abu_owner)?`);
  if (f.ownsUserTable || f.ownedObjects > 0) p.push(`${who} ejer tabeller (eller er medlem af ejerrollen). Appen skal bruge abu_app, ikke ejeren abu_owner.`);
  if (f.ownsDatabase) p.push(`${who} ejer databasen.`);
  if (f.schemaCreate) p.push(`${who} kan oprette objekter i schema public (DDL). Kør npm run db:roles.`);
  return p;
}

export function describeDbRole(f: DbRoleFacts): string {
  return `[db] rolle=${f.user} · TLS=${f.ssl ? "ja" : "nej"} · superbruger=${f.superuser ? "ja" : "nej"} · BYPASSRLS=${f.bypassRls ? "ja" : "nej"} · ejer=${f.ownsUserTable || f.ownedObjects > 0 ? "ja" : "nej"}`;
}

/** Én forbindelse (ikke appens pool), én forespørgsel, lukkes igen. Samme TLS-opsætning som appen. */
export async function readDbRoleFacts(url: string): Promise<DbRoleFacts> {
  const client = new pg.Client(pgClientConfig(url));
  await client.connect();
  try {
    const { rows } = await client.query<DbRoleFacts>(DB_ROLE_FACTS_SQL);
    if (!rows[0]) throw new Error("rollen blev ikke fundet i pg_roles");
    return rows[0];
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Kaldes ved opstart (instrumentation) efter konfigurationstjekket. I produktion kastes EnvConfigError (appen starter
 * ikke), hvis rollen er for stærk, eller hvis databasen ikke kan nås (fail-closed). Ellers kun en advarsel i loggen.
 */
export async function assertDbRuntimeRole(url: string, mode: AppEnv, log: (msg: string) => void = console.log, read = readDbRoleFacts): Promise<DbRoleFacts | null> {
  let facts: DbRoleFacts;
  try {
    facts = await read(url);
  } catch (e) {
    const msg = `Databaserollen kunne ikke kontrolleres: ${e instanceof Error ? e.message : String(e)}`;
    if (mode === "production") throw new EnvConfigError([msg]);
    log(`[db] ADVARSEL: ${msg}`);
    return null;
  }
  log(describeDbRole(facts));
  const problems = dbRoleProblems(facts);
  if (problems.length) {
    if (mode === "production") throw new EnvConfigError(problems);
    log(`[db] ADVARSEL (tilladt uden for produktion): ${problems.join(" ")}`);
  }
  return facts;
}
