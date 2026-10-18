/*
 * Opretter den første administrator i et nyt miljø (også produktion) og udskriver et engangslink til at vælge adgangskode.
 *   npm run create-admin -- --email admin@firma.dk --name "Fornavn Efternavn"
 *   npm run create-admin                                          # spørger efter e-mail og navn (i en terminal)
 *   npm run create-admin -- --email admin@firma.dk --reset        # nyt link til en eksisterende administrator
 *   npm run create-admin -- --email admin@firma.dk --reset-mfa    # nødprocedure: nyt link + nulstil totrinsbekræftelse
 * Linket skrives kun til denne terminal (ikke til app-loggen). Det udløber efter 7 dage og kan kun bruges én gang.
 * Der kan ikke angives en adgangskode (H-1). Ved første login skal administratoren opsætte totrinsbekræftelse.
 */
import "./owner-db-env"; // FØRST: kør som ejeren (DATABASE_URL_MIGRATE), før Prisma-klienten indlæses
import { createInterface } from "node:readline";
import { createAdminInvite, CREATE_ADMIN_USAGE, resolveCreateAdminArgs } from "../src/lib/admin-bootstrap";
import { prisma } from "../src/lib/db";
import { getEnv } from "../src/lib/env";

async function main() {
  // Spørg i en terminal; linjerne bufferes, så indsatte svar (flere linjer på én gang) ikke går tabt
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout, terminal: false }) : null;
  const lines = rl?.[Symbol.asyncIterator]();
  const ask = lines
    ? async (q: string) => {
        process.stdout.write(q);
        const r = await lines.next();
        return r.done ? "" : String(r.value);
      }
    : null;
  const args = await resolveCreateAdminArgs(process.argv.slice(2), ask).finally(() => rl?.close());
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
  if (args.resetMfa) console.log("Totrinsbekræftelsen er nulstillet, og alle sessioner er logget ud.");
  console.log(`Åbn linket og vælg en adgangskode (gyldigt til ${r.expiresAt.toISOString()}, kan bruges én gang):\n\n  ${r.link}\n`);
  console.log("Ved første login skal administratoren opsætte totrinsbekræftelse med en godkendelses-app (Authy, Google Authenticator, 1Password …).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
