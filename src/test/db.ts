import type { PrismaClient } from "@prisma/client";
import { describe } from "vitest";

/** `describeDb` springer over uden TEST_DATABASE_URL (enhedstests kræver ingen database). */
export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
export const describeDb = hasTestDb ? describe : describe.skip;

/** Unikt suffiks, så tests i parallelle filer ikke rører hinandens rækker. */
export const uid = (prefix = "t") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

let owner: PrismaClient | null = null;

/**
 * Forbindelse som databasens ejer (TEST_DATABASE_URL_OWNER = abu_owner) – KUN til oprydning, som appens rolle bevidst
 * ikke må (fx er AuditLog append-only for abu_app). Testene selv kører som abu_app (TEST_DATABASE_URL). Uden
 * TEST_DATABASE_URL_OWNER (en lokal opsætning med én rolle) bruges testdatabasen direkte.
 */
export async function ownerDb(): Promise<PrismaClient> {
  if (!owner) {
    const { createPrismaClient } = await import("@/lib/db");
    owner = createPrismaClient(process.env.TEST_DATABASE_URL_OWNER || process.env.TEST_DATABASE_URL);
  }
  return owner;
}
