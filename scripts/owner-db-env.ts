/*
 * Seed og create-admin kører som databasens ejer (abu_owner), ligesom migrationerne – ikke som appens rolle abu_app.
 * Importeres som det FØRSTE i scriptet: Prisma-klienten (src/lib/db.ts) læser DATABASE_URL, når modulet indlæses.
 * Lokalt læses .env (som prisma.config.ts gør); variabler fra miljøet vinder.
 */
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
if (process.env.DATABASE_URL_MIGRATE) process.env.DATABASE_URL = process.env.DATABASE_URL_MIGRATE;
