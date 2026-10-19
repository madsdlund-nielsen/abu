"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireFreshMfa } from "@/lib/auth";
import { deactivateAdmin, displayInviteLink, inviteAdmin, resendAdminInvite, resetAdminMfa, revokeAdminDevices } from "@/lib/admin-users";
import { getEnv } from "@/lib/env";
import { setTrustedDeviceDays } from "@/lib/mfa/service";
import { TRUSTED_DEVICE_DAYS_MAX } from "@/lib/mfa/trusted-device";
import { rateLimit } from "@/lib/rate-limit";
import { redirectWith } from "@/lib/redirect";

/**
 * Administratorer (Admin → Administratorer). Alle handlinger: kun ADMIN (serverside), frisk kode ≤ 15 min
 * (`requireFreshMfa`), rate limit pr. administrator og audit-log.
 */
const PAGE = "/admin/administratorer";
const TOO_MANY = "For mange handlinger på kort tid. Vent lidt, og prøv igen.";

export interface AdminInviteState {
  ok?: string;
  error?: string;
  /** Kun i konsol-tilstand eller ved mislykket mail. Vises i UI'et, aldrig i URL'en. */
  inviteLink?: string;
  values?: { name: string; email: string };
  at?: number;
}

async function linkIfNeeded(userId: string, sent: boolean): Promise<string | undefined> {
  if (sent && getEnv().EMAIL_PROVIDER !== "console") return undefined;
  return displayInviteLink(userId);
}

export async function inviteAdminAction(_prev: AdminInviteState, formData: FormData): Promise<AdminInviteState> {
  const { user: admin } = await requireFreshMfa(PAGE);
  const values = { name: String(formData.get("name") ?? "").trim(), email: String(formData.get("email") ?? "").trim() };
  if (!(await rateLimit(`admin-invite:${admin.id}`, 10, 60 * 60_000))) return { error: TOO_MANY, values, at: Date.now() };
  const r = await inviteAdmin(admin.id, values);
  if (!r.ok) return { error: r.error, values, at: Date.now() };
  revalidatePath(PAGE);
  return {
    ok: r.sent
      ? `${r.name} er inviteret som administrator, og invitationen er sendt til ${r.email}.`
      : `${r.name} er inviteret som administrator. Mailen kunne ikke sendes – brug linket herunder.`,
    inviteLink: await linkIfNeeded(r.userId, r.sent),
    at: Date.now(),
  };
}

export async function resendAdminInviteAction(_prev: AdminInviteState, formData: FormData): Promise<AdminInviteState> {
  const { user: admin } = await requireFreshMfa(PAGE);
  if (!(await rateLimit(`admin-invite:${admin.id}`, 10, 60 * 60_000))) return { error: TOO_MANY, at: Date.now() };
  const r = await resendAdminInvite(admin.id, String(formData.get("userId") ?? ""));
  if (!r.ok) return { error: r.error, at: Date.now() };
  return { ok: r.sent ? `Ny invitation sendt til ${r.email}.` : "Mailen kunne ikke sendes – brug linket.", inviteLink: await linkIfNeeded(r.userId, r.sent), at: Date.now() };
}

async function manage(fn: (actorId: string, targetId: string) => Promise<{ ok: true; message: string } | { ok: false; error: string }>, formData: FormData): Promise<never> {
  const { user: admin } = await requireFreshMfa(PAGE);
  if (!(await rateLimit(`admin-manage:${admin.id}`, 30))) redirectWith(PAGE, "err", TOO_MANY);
  const r = await fn(admin.id, String(formData.get("userId") ?? ""));
  revalidatePath(PAGE);
  if (!r.ok) redirectWith(PAGE, "err", r.error);
  redirectWith(PAGE, "ok", r.message);
}

/** Deaktivér en administrator (ikke sig selv, ikke den sidste aktive). Sessioner og betroede enheder tilbagekaldes. */
export async function deactivateAdminAction(formData: FormData) {
  await manage((actor, target) => deactivateAdmin(actor, target), formData);
}

/** Nulstil en anden administrators totrinsbekræftelse (kræver din egen friske kode). */
export async function resetAdminMfaAction(formData: FormData) {
  await manage((actor, target) => resetAdminMfa(actor, target), formData);
}

/** Fjern en administrators betroede enheder. */
export async function revokeAdminDevicesAction(formData: FormData) {
  await manage((actor, target) => revokeAdminDevices(actor, target), formData);
}

/** Varighed for «Husk denne enhed» (0-30 dage; 0 = slået fra). */
export async function saveTrustedDeviceDaysAction(formData: FormData) {
  const { user: admin } = await requireFreshMfa(PAGE);
  const raw = String(formData.get("days") ?? "").trim();
  const n = Number(raw);
  if (!/^\d{1,2}$/.test(raw) || n > TRUSTED_DEVICE_DAYS_MAX) redirectWith(PAGE, "err", `Angiv et helt antal dage fra 0 til ${TRUSTED_DEVICE_DAYS_MAX}.`);
  const days = await setTrustedDeviceDays(n);
  await audit(admin.id, "mfa.trusted_device_days", "AppSetting", "mfa.trustedDeviceDays", String(days));
  revalidatePath(PAGE);
  redirectWith(PAGE, "ok", days === 0 ? "«Husk denne enhed» er slået fra. Koden kræves ved hvert login." : `Betroede enheder husker nu i højst ${days} dage.`);
}
