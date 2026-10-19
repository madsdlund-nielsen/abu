import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma 7 indlæser ikke længere .env automatisk. Lokalt læses .env (hvis den findes); i Docker/CI kommer variablerne fra miljøet.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  // `prisma generate` kræver ingen forbindelse. Migrationer (og seed/create-admin, se scripts/owner-db-env.ts) kører som
  // ejeren abu_owner via DATABASE_URL_MIGRATE – appen selv bruger DATABASE_URL (abu_app, kun DML). Uden
  // DATABASE_URL_MIGRATE bruges DATABASE_URL (kun en lokal opsætning med én rolle).
  // TLS for migrationer angives i URL'en med Prismas egne parametre, fx ?sslmode=require&sslaccept=strict&sslcert=/sti/ca.pem.
  datasource: { url: process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL || "" },
});
