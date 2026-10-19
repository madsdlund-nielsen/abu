import type { Prisma, Role } from "@prisma/client";
import { prisma } from "./db";

/**
 * Navne på andre brugere (RLS). Kunder og rådgivere kan ikke læse hinandens `User`-rækker (e-mail, telefon, adgangskode-
 * hash, MFA …); de ser kun navn og rolle via `rls.user_directory`: sig selv, board-/mødekolleger og aktive rådgivere
 * (kataloget før login). Admin og system ser alle. Ukendte eller utilladte id'er mangler i resultatet.
 */
export interface DirectoryUser {
  id: string;
  name: string;
  role: Role;
}

type Db = Prisma.TransactionClient | typeof prisma;

export async function userDirectory(ids: Iterable<string>, db: Db = prisma): Promise<Map<string, DirectoryUser>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const rows = await db.$queryRaw<DirectoryUser[]>`SELECT id, name, role::text AS role FROM rls.user_directory(${unique}::text[])`;
  return new Map(rows.map((r) => [r.id, r]));
}

/** Navnet, eller en neutral tekst hvis brugeren ikke (længere) findes eller ikke må ses. */
export function nameOf(dir: Map<string, DirectoryUser>, id: string | null | undefined, fallback = "Ukendt"): string {
  return (id && dir.get(id)?.name) || fallback;
}
