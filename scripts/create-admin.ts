/*
 * Opretter den første administrator i et nyt miljø (også produktion) og udskriver et engangslink til at vælge adgangskode.
 *   npm run create-admin -- --email admin@firma.dk --name "Fornavn Efternavn"
 *   npm run create-admin -- --email admin@firma.dk --reset      # nyt link til en eksisterende administrator
 * Linket skrives kun til denne terminal (ikke til app-loggen). Det udløber efter 7 dage og kan kun bruges én gang.
 */
import { createAdminInvite, CREATE_ADMIN_USAGE, parseCreateAdminArgs } from "../src/lib/admin-bootstrap";
import { prisma } from "../src/lib/db";
import { getEnv } from "../src/lib/env";

async function main() {
  const args = parseCreateAdminArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(`${args.error}\n${CREATE_ADMIN_USAGE}`);
    process.exitCode = 2;
    return;
  }
  const r = await createAdminInvite(prisma, args, getEnv().APP_URL);
  if (!r.ok) {
    console.error(r.error);
    process.exitCode = 1;
    return;
  }
  console.log(`${r.created ? "Administrator oprettet" : "Nyt link udstedt"}: ${args.email}`);
  console.log(`Åbn linket og vælg en adgangskode (gyldigt til ${r.expiresAt.toISOString()}, kan bruges én gang):\n\n  ${r.link}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
