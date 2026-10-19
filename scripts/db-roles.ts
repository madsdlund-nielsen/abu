/*
 * Opretter/opdaterer databaserollerne (RLS fase 0) i den database, DATABASE_URL_PROVISION peger på – se prisma/roles.sql.
 *   DATABASE_URL_PROVISION=postgresql://postgres:…@vært:5432/abu \
 *   ABU_OWNER_PASSWORD=… ABU_APP_PASSWORD=… [ABU_JOBS_PASSWORD=…] npm run db:roles
 * Kræver en superbruger (kun til provisionering – aldrig i appens miljø). Idempotent: kør igen efter skift af adgangskode
 * og på hver database i klyngen (fx både abu og abu_test). Tom adgangskode = uændret. Lokalt læses .env.
 * Adgangskoderne sendes som SCRAM-SHA-256-verifikatorer (aldrig i klartekst) og skrives aldrig ud.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { parseDbUrl, pgClientConfig } from "../src/lib/db-config";
import { DB_ROLES, dbPasswordProblem, scramSha256Verifier } from "../src/lib/db-roles";

const SUMMARY_SQL = `
SELECT r.rolname AS rolle, r.rolcanlogin AS login, r.rolsuper AS superbruger, r.rolbypassrls AS bypassrls,
       r.rolcreatedb AS createdb, r.rolcreaterole AS createrole,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relowner = r.oid) AS ejer_af_tabeller,
       has_schema_privilege(r.oid, 'public', 'CREATE') AS ddl_i_public,
       coalesce(array_to_string(r.rolconfig, ' '), '') AS indstillinger
  FROM pg_roles r WHERE r.rolname = ANY($1) ORDER BY r.rolname`;

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const url = process.env.DATABASE_URL_PROVISION;
  if (!url) throw new Error("DATABASE_URL_PROVISION mangler (en superbruger-URL til databasen, fx postgresql://postgres:…@localhost:5432/abu).");
  const passwords = { owner: process.env.ABU_OWNER_PASSWORD ?? "", app: process.env.ABU_APP_PASSWORD ?? "", jobs: process.env.ABU_JOBS_PASSWORD ?? "" };
  const problems = [
    passwords.owner && dbPasswordProblem("ABU_OWNER_PASSWORD", passwords.owner),
    passwords.app && dbPasswordProblem("ABU_APP_PASSWORD", passwords.app),
    passwords.jobs && dbPasswordProblem("ABU_JOBS_PASSWORD", passwords.jobs),
  ].filter(Boolean);
  if (problems.length) throw new Error(problems.join("\n"));

  const db = parseDbUrl(url);
  // Provisionering er ikke appen: ingen statement-/lock-timeout
  const client = new pg.Client({ ...pgClientConfig(url), application_name: "abu-db-roles", statement_timeout: 0, lock_timeout: 0 });
  await client.connect();
  try {
    const v = (pw: string) => (pw ? scramSha256Verifier(pw) : "");
    await client.query("SELECT set_config('abu.owner_password', $1, false), set_config('abu.app_password', $2, false), set_config('abu.jobs_password', $3, false)", [
      v(passwords.owner),
      v(passwords.app),
      v(passwords.jobs),
    ]);
    await client.query(readFileSync(path.join(process.cwd(), "prisma/roles.sql"), "utf8"));
    const { rows } = await client.query(SUMMARY_SQL, [Object.values(DB_ROLES)]);
    console.log(`Roller opdateret i databasen «${db.database}» på ${db.host} (adgangskoder: ${Object.entries(passwords).filter(([, p]) => p).map(([k]) => k).join(", ") || "uændrede"}).`);
    console.table(rows);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(`[db:roles] ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
