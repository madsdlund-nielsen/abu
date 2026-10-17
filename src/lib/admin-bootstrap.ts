import type { PrismaClient } from "@prisma/client";
import { parseEnv, resolveAppEnv } from "./env";
import { randomToken, sha256 } from "./tokens";

const INVITE_DAYS = 7;

export interface CreateAdminArgs {
  email: string;
  name: string;
  /** Eksisterende admin: udsted et nyt engangslink (fx glemt adgangskode, ingen mail sat op endnu). */
  reset: boolean;
}

export const CREATE_ADMIN_USAGE = 'Brug: npm run create-admin -- --email admin@firma.dk --name "Fornavn Efternavn" [--reset]';

/** Parser `--email x --name y [--reset]` (også `--email=x`). Ren funktion. */
export function parseCreateAdminArgs(argv: string[]): CreateAdminArgs | { error: string } {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) return { error: `Ukendt argument: ${a}` };
    const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (k === "reset") out.reset = true;
    else if (k === "email" || k === "name") {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith("--")) return { error: `--${k} mangler en værdi.` };
      out[k] = v;
    } else return { error: `Ukendt flag: --${k}` };
  }
  const email = String(out.email ?? "").trim().toLowerCase();
  const name = String(out.name ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Angiv en gyldig --email." };
  if (!out.reset && name.length < 2) return { error: "Angiv --name (mindst 2 tegn)." };
  return { email, name, reset: out.reset === true };
}

/** Seed (demodata med kendte adgangskoder) må aldrig køre i produktion. Returnerer en årsag eller null. */
export function seedRefusal(raw: Record<string, string | undefined>): string | null {
  const mode = resolveAppEnv(parseEnv(raw), raw.NODE_ENV);
  if (mode === "production") {
    return "Seed afvist: miljøet er produktion (NODE_ENV/APP_ENV). Seed opretter demobrugere med kendte adgangskoder. Brug `npm run create-admin` til den første administrator.";
  }
  return null;
}

/**
 * Opretter den første (eller en ny) administrator uden adgangskode og returnerer et engangslink (7 dage), hvor
 * administratoren selv vælger adgangskode. Ingen adgangskoder i kode eller logs.
 */
export async function createAdminInvite(
  db: PrismaClient,
  args: CreateAdminArgs,
  appUrl: string,
  now = new Date(),
): Promise<{ ok: true; link: string; created: boolean; expiresAt: Date } | { ok: false; error: string }> {
  const existing = await db.user.findUnique({ where: { email: args.email } });
  if (existing && existing.role !== "ADMIN") return { ok: false, error: `${args.email} findes allerede med rollen ${existing.role}.` };
  if (existing && existing.passwordHash && !args.reset) {
    return { ok: false, error: `${args.email} er allerede administrator. Brug --reset for at udstede et nyt link.` };
  }
  const user = existing ?? (await db.user.create({ data: { email: args.email, name: args.name, role: "ADMIN" } }));
  const purpose = user.passwordHash ? "RESET" : "INVITE";
  // Gamle, ubrugte links holder op med at virke
  await db.passwordToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86_400_000);
  await db.passwordToken.create({ data: { userId: user.id, tokenHash: sha256(token), purpose, expiresAt } });
  await db.auditLog.create({ data: { userId: null, action: existing ? "admin.bootstrap_reset" : "admin.bootstrap_create", entity: "User", entityId: user.id } });
  const base = appUrl.replace(/\/$/, "");
  const link = `${base}/set-password?token=${encodeURIComponent(token)}${purpose === "RESET" ? "&reset=1" : ""}`;
  return { ok: true, link, created: !existing, expiresAt };
}
