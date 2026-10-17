import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/** Standard for lokal udvikling. I produktion skal DATABASE_URL være sat (se prod-guard i env.ts). */
export const DEV_DATABASE_URL = "postgresql://abu:abu@localhost:5432/abu";

/** Prisma 7 forbinder via en driver-adapter (node-postgres) i stedet for den gamle Rust-motor. */
export function createPrismaClient(url = process.env.DATABASE_URL || DEV_DATABASE_URL): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
