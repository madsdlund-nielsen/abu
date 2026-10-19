/*
 * Installerer nøglen til den signerede databasekontekst (RLS) i databasen – som ejeren abu_owner (DATABASE_URL_MIGRATE).
 *   npm run db:context-key              # efter `prisma migrate deploy`; idempotent
 *   npm run db:context-key -- --prune   # efter en rotation: fjern andre nøgler end den nuværende
 * Hemmeligheden er DB_CONTEXT_SECRET (samme værdi som i app-processen). Uden for produktion bruges udviklingsnøglen, hvis
 * den ikke er sat. Kun nøglens id (kid) udskrives – aldrig hemmeligheden.
 */
import { existsSync } from "node:fs";
import pg from "pg";
import { pgClientConfig } from "../src/lib/db-config";
import { contextSecretForInstall, installContextKey } from "../src/lib/db-context-key";

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const url = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_MIGRATE mangler (ejeren abu_owner).");
  const s = contextSecretForInstall(process.env);
  if ("error" in s) throw new Error(s.error);
  const client = new pg.Client({ ...pgClientConfig(url), application_name: "abu-db-context-key" });
  await client.connect();
  try {
    const r = await installContextKey(client, s.secret, { prune: process.argv.includes("--prune") });
    console.log(`Kontekstnøgle installeret (kid=${r.kid}${s.dev ? ", UDVIKLINGSNØGLE – kun lokalt" : ""})${r.pruned ? `; ${r.pruned} gammel nøgle(r) fjernet` : ""}.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(`[db:context-key] ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
