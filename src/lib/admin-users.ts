import type { Prisma, User } from "@prisma/client";
import { z } from "zod";
import { audit } from "./audit";
import { prisma } from "./db";
import { inviteUrl } from "./emails";
import { clearMfaData, getTrustedDeviceDays, revokeTrustedDevices } from "./mfa/service";
import { isTrustedDeviceValid } from "./mfa/trusted-device";
import { accountEvents } from "./notifications/service";
import { randomToken, sha256 } from "./tokens";

/**
 * Platform-administratorer: invitation, ny invitation, deaktivering, nulstilling af MFA og betroede enheder.
 * Server actions (`app/actions/admin-users.ts`) kræver ADMIN, en frisk kode (≤ 15 min) og rate limit; her ligger
 * forretningsreglerne, så de kan testes direkte.
 */

/** En aktiv administrator kan logge ind: rollen ADMIN, ikke deaktiveret og med en valgt adgangskode. */
export const ACTIVE_ADMIN_WHERE = { role: "ADMIN", deactivatedAt: null, passwordHash: { not: null } } satisfies Prisma.UserWhereInput;

export const INVITE_DAYS = 7;

export interface AdminRow {
  id: string;
  name: string;
  email: string;
  status: "active" | "invited" | "deactivated";
  mfaEnabledAt: Date | null;
  lastLoginAt: Date | null;
  deactivatedAt: Date | null;
  trustedDevices: number;
  createdAt: Date;
}

export function adminStatus(u: Pick<User, "deactivatedAt" | "passwordHash">): AdminRow["status"] {
  if (u.deactivatedAt) return "deactivated";
  return u.passwordHash ? "active" : "invited";
}

export async function listAdmins(now = new Date()): Promise<AdminRow[]> {
  const [admins, days] = await Promise.all([
    prisma.user.findMany({
      where: { role: "ADMIN" },
      orderBy: [{ deactivatedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
      include: { trustedDevices: { select: { createdAt: true, expiresAt: true } } },
    }),
    getTrustedDeviceDays(),
  ]);
  return admins.map((a) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    status: adminStatus(a),
    mfaEnabledAt: a.mfaEnabledAt,
    lastLoginAt: a.lastLoginAt,
    deactivatedAt: a.deactivatedAt,
    trustedDevices: a.trustedDevices.filter((d) => isTrustedDeviceValid(d, now, days)).length,
    createdAt: a.createdAt,
  }));
}

/**
 * Ren regel: må `actorId` deaktivere `target`? `activeOthers` = antal aktive administratorer ud over target.
 * Man kan ikke deaktivere sig selv, og den sidste aktive administrator kan ikke deaktiveres.
 */
export function deactivationProblem(input: {
  actorId: string;
  target: Pick<User, "id" | "role" | "deactivatedAt" | "name"> | null;
  actorActive: boolean;
  activeOthers: number;
}): string | null {
  const { actorId, target } = input;
  if (!target || target.role !== "ADMIN") return "Administratoren findes ikke.";
  if (target.id === actorId) return "Du kan ikke deaktivere dig selv. Bed en anden administrator om det.";
  if (!input.actorActive) return "Din egen konto er ikke aktiv.";
  if (target.deactivatedAt) return `${target.name} er allerede deaktiveret.`;
  if (input.activeOthers < 1) return "Den sidste aktive administrator kan ikke deaktiveres.";
  return null;
}

export type AdminResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Deaktiverer en administrator: kan ikke logge ind, alle sessioner og betroede enheder tilbagekaldes, og ubrugte
 * links holder op med at virke. Under en advisory lock, så to administratorer ikke kan deaktivere hinanden samtidig.
 */
export async function deactivateAdmin(actorId: string, targetId: string, now = new Date()): Promise<AdminResult> {
  const r = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('abu-admin-accounts'))`;
    const [target, actor, activeOthers] = await Promise.all([
      tx.user.findUnique({ where: { id: targetId } }),
      tx.user.findUnique({ where: { id: actorId } }),
      tx.user.count({ where: { ...ACTIVE_ADMIN_WHERE, id: { not: targetId } } }),
    ]);
    const problem = deactivationProblem({
      actorId,
      target,
      actorActive: Boolean(actor && actor.role === "ADMIN" && !actor.deactivatedAt),
      activeOthers,
    });
    if (problem || !target) return { ok: false as const, error: problem ?? "Administratoren findes ikke." };
    await tx.user.update({ where: { id: targetId }, data: { deactivatedAt: now } });
    await tx.session.deleteMany({ where: { userId: targetId } });
    await tx.passwordToken.updateMany({ where: { userId: targetId, usedAt: null }, data: { usedAt: now } });
    return { ok: true as const, name: target.name };
  });
  if (!r.ok) return r;
  await revokeTrustedDevices(targetId, "admin_deactivated", actorId);
  await audit(actorId, "admin.deactivate", "User", targetId);
  return { ok: true, message: `${r.name} er deaktiveret. Alle sessioner og betroede enheder er tilbagekaldt.` };
}

const inviteSchema = z.object({
  name: z.string().trim().min(2, "Indtast navn (mindst 2 tegn).").max(120, "Navnet er for langt."),
  email: z.string().trim().toLowerCase().email("Indtast en gyldig e-mailadresse."),
});

/** Engangslink (7 dage). Ældre ubrugte links for brugeren ugyldiggøres først. */
async function issueInviteToken(userId: string, now: Date): Promise<string> {
  const token = randomToken();
  await prisma.passwordToken.create({ data: { userId, tokenHash: sha256(token), purpose: "INVITE", expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000) } });
  return token;
}

export type InviteOutcome = { ok: true; userId: string; name: string; email: string; sent: boolean; reactivated: boolean } | { ok: false; error: string };

/**
 * Inviterer en ny administrator: ADMIN uden adgangskode + invitationsmail (skabelonen «Administrator inviteret»).
 * En deaktiveret administrator med samme e-mail genaktiveres som ny invitation (adgangskode og MFA nulstilles).
 */
export async function inviteAdmin(actorId: string, input: { name: string; email: string }, now = new Date()): Promise<InviteOutcome> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ugyldige felter." };
  const { name, email } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.role !== "ADMIN") return { ok: false, error: "Der findes allerede en bruger med den e-mail (som rådgiver eller kunde)." };
  if (existing && !existing.deactivatedAt) {
    return { ok: false, error: existing.passwordHash ? `${existing.email} er allerede administrator.` : `${existing.email} er allerede inviteret. Brug «Send ny invitation».` };
  }
  let user: User;
  if (existing) {
    await clearMfaData(existing.id);
    await prisma.passwordToken.updateMany({ where: { userId: existing.id, usedAt: null }, data: { usedAt: now } });
    user = await prisma.user.update({ where: { id: existing.id }, data: { name, passwordHash: null, deactivatedAt: null, failedLoginCount: 0, lockedUntil: null } });
    await audit(actorId, "admin.reactivate_invite", "User", user.id);
  } else {
    user = await prisma.user.create({ data: { name, email, role: "ADMIN" } });
    await audit(actorId, "admin.create", "User", user.id);
  }
  const token = await issueInviteToken(user.id, now);
  const sent = await accountEvents.adminInvited(user, inviteUrl(token));
  await audit(actorId, "admin.invite", "User", user.id, sent ? "sendt" : "ikke sendt");
  return { ok: true, userId: user.id, name: user.name, email: user.email, sent, reactivated: Boolean(existing) };
}

/** Ny invitation til en administrator, der endnu ikke har valgt adgangskode. Ældre links ugyldiggøres. */
export async function resendAdminInvite(actorId: string, targetId: string, now = new Date()): Promise<InviteOutcome> {
  const user = await prisma.user.findFirst({ where: { id: targetId, role: "ADMIN" } });
  if (!user) return { ok: false, error: "Administratoren findes ikke." };
  if (user.deactivatedAt) return { ok: false, error: `${user.name} er deaktiveret. Invitér e-mailen igen for at genaktivere.` };
  if (user.passwordHash) return { ok: false, error: `${user.name} har allerede accepteret invitationen.` };
  await prisma.passwordToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
  const token = await issueInviteToken(user.id, now);
  const sent = await accountEvents.adminInvited(user, inviteUrl(token));
  await audit(actorId, "admin.invite", "User", user.id, `ny invitation; ${sent ? "sendt" : "ikke sendt"}`);
  return { ok: true, userId: user.id, name: user.name, email: user.email, sent, reactivated: false };
}

/** Ekstra link til visning for den inviterende (konsol-tilstand eller mislykket mail). */
export async function displayInviteLink(userId: string, now = new Date()): Promise<string> {
  return inviteUrl(await issueInviteToken(userId, now));
}

/**
 * Nulstiller en anden administrators totrinsbekræftelse (fx mistet telefon): hemmelighed, gendannelseskoder og
 * betroede enheder slettes, og alle sessioner logges ud. Ved næste login skal vedkommende opsætte MFA igen.
 */
export async function resetAdminMfa(actorId: string, targetId: string): Promise<AdminResult> {
  if (actorId === targetId) return { ok: false, error: "Du kan ikke nulstille din egen totrinsbekræftelse her. Brug en gendannelseskode, eller bed en anden administrator." };
  const target = await prisma.user.findFirst({ where: { id: targetId, role: "ADMIN" } });
  if (!target) return { ok: false, error: "Administratoren findes ikke." };
  const devices = await prisma.trustedDevice.count({ where: { userId: targetId } });
  await clearMfaData(targetId);
  await prisma.session.deleteMany({ where: { userId: targetId } });
  await audit(actorId, "admin.mfa_reset", "User", targetId, devices ? `${devices} betroede enhed(er) fjernet` : undefined);
  return { ok: true, message: `Totrinsbekræftelsen for ${target.name} er nulstillet. Vedkommende er logget ud og skal opsætte den igen ved næste login.` };
}

export async function revokeAdminDevices(actorId: string, targetId: string): Promise<AdminResult> {
  const target = await prisma.user.findFirst({ where: { id: targetId, role: "ADMIN" } });
  if (!target) return { ok: false, error: "Administratoren findes ikke." };
  const n = await revokeTrustedDevices(targetId, "admin", actorId);
  // Sessioner, der er startet uden kode fra en betroet enhed, logges også ud
  if (n) await prisma.session.deleteMany({ where: { userId: targetId, trustedDeviceId: { not: null } } });
  return { ok: true, message: n ? `${n} betroede ${n === 1 ? "enhed" : "enheder"} for ${target.name} er fjernet.` : `${target.name} har ingen betroede enheder.` };
}
