import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma 7 indlæser ikke længere .env automatisk. Lokalt læses .env (hvis den findes); i Docker/CI kommer variablerne fra miljøet.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  // `prisma generate` kræver ingen forbindelse; migrate/seed bruger DATABASE_URL fra miljøet.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
