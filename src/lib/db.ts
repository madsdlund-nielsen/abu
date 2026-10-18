import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { DEV_DATABASE_URL, pgPoolConfig } from "./db-config";

export { DEV_DATABASE_URL };

/**
 * Prisma 7 forbinder via en driver-adapter (node-postgres) i stedet for den gamle Rust-motor. Poolstørrelse, TLS
 * (sslmode + DATABASE_SSL_CA) og timeouts kommer fra `pgPoolConfig` (src/lib/db-config.ts). I produktion skal
 * DATABASE_URL være sat og pege på app-rollen abu_app (prod-guard i env.ts + db-guard.ts).
 */
export function createPrismaClient(url = process.env.DATABASE_URL || DEV_DATABASE_URL): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(url)) });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
