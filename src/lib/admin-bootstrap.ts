import type { PrismaClient } from "@prisma/client";
import { parseEnv, resolveAppEnv } from "./env";
import { randomToken, sha256 } from "./tokens";

const INVITE_DAYS = 7;

export interface CreateAdminArgs {
  email: string;
  name: string;
  /** Eksisterende admin: udsted et nyt engangslink (fx glemt adgangskode, ingen mail sat op endnu). */
  reset: boolean;
  /**
   * Nødprocedure: nulstil også administratorens totrinsbekræftelse (mistet telefon og gendannelseskoder, og ingen anden
   * administrator kan gøre det). Kræver adgang til serveren. Vedkommende opsætter MFA igen ved næste login.
   */
  resetMfa: boolean;
}

export const CREATE_ADMIN_USAGE = 'Brug: npm run create-admin -- --email admin@firma.dk --name "Fornavn Efternavn" [--reset] [--reset-mfa]\n(Uden --email/--name spørger scriptet, når det køres i en terminal.)';

type Parsed = { email?: string; name?: string; reset: boolean; resetMfa: boolean };

function parseFlags(argv: string[]): Parsed | { error: string } {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) return { error: `Ukendt argument: ${a}` };
    const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (k === "reset") out.reset = true;
    else if (k === "reset-mfa") out.resetMfa = true;
    else if (k === "email" || k === "name") {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith("--")) return { error: `--${k} mangler en værdi.` };
      out[k] = v;
    } else return { error: `Ukendt flag: --${k}` };
  }
  return {
    email: typeof out.email === "string" ? out.email : undefined,
    name: typeof out.name === "string" ? out.name : undefined,
    reset: out.reset === true || out.resetMfa === true,
    resetMfa: out.resetMfa === true,
  };
}

function validate(p: Parsed): CreateAdminArgs | { error: string } {
  const email = String(p.email ?? "").trim().toLowerCase();
  const name = String(p.name ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Angiv en gyldig --email." };
  if (!p.reset && name.length < 2) return { error: "Angiv --name (mindst 2 tegn)." };
  return { email, name, reset: p.reset, resetMfa: p.resetMfa };
}

/** Parser `--email x --name y [--reset] [--reset-mfa]` (også `--email=x`). Ren funktion. */
export function parseCreateAdminArgs(argv: string[]): CreateAdminArgs | { error: string } {
  const p = parseFlags(argv);
  return "error" in p ? p : validate(p);
}

/**
 * Som parseCreateAdminArgs, men spørger efter manglende e-mail og navn (interaktivt i en terminal). `ask` er null, når
 * der ikke er en terminal (fx i CI/Docker uden -it): så kræves flagene.
 */
export async function resolveCreateAdminArgs(argv: string[], ask: ((question: string) => Promise<string>) | null): Promise<CreateAdminArgs | { error: string }> {
  const p = parseFlags(argv);
  if ("error" in p) return p;
  if (ask) {
    if (!p.email) p.email = await ask("E-mail til administratoren: ");
    if (!p.name && !p.reset) p.name = await ask("Navn: ");
  }
  return validate(p);
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
  let user = existing ?? (await db.user.create({ data: { email: args.email, name: args.name, role: "ADMIN" } }));
  // En deaktiveret administrator genaktiveres (nødprocedure via serveren)
  if (user.deactivatedAt) user = await db.user.update({ where: { id: user.id }, data: { deactivatedAt: null } });
  if (args.resetMfa) {
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { mfaEnabledAt: null, mfaSecretEnc: null, mfaKeyId: null, mfaPendingSecretEnc: null, mfaPendingCreatedAt: null, mfaLastUsedStep: null, mfaFailedCount: 0, mfaLastFailedAt: null },
      }),
      db.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
      db.trustedDevice.deleteMany({ where: { userId: user.id } }),
      db.session.deleteMany({ where: { userId: user.id } }),
    ]);
    await db.auditLog.create({ data: { userId: null, action: "admin.bootstrap_mfa_reset", entity: "User", entityId: user.id } });
  }
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
