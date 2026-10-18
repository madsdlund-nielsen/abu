"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { createPasswordToken, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendInviteEmail, inviteUrl } from "@/lib/emails";
import { savePriceBounds, validatePriceBounds } from "@/lib/advisor-price";
import { setAdvisorActive } from "@/lib/advisor-activation";
import { parseAdvisorProfile } from "@/lib/advisor-profile";
import { formValues, type FormState } from "@/lib/form-state";
import { getEnv } from "@/lib/env";
import { setHolidayBlocked } from "@/lib/holidays";
import { IdempotencyInFlightError, withIdempotency } from "@/lib/idempotency";
import { processJobs } from "@/lib/jobs";
import { eraseUser } from "@/lib/erasure";
import { redirectWith } from "@/lib/redirect";

export interface InviteState {
  ok?: string;
  error?: string;
  /** Kun når mailen ikke kunne sendes, eller e-mail kører i konsol-tilstand. Vises i UI'et, aldrig i URL'en. */
  inviteLink?: string;
  values?: { name: string; email: string; title: string };
}

/** Engangslink til visning i admin (konsol-tilstand eller mislykket mail). Et nyt token; det i mailen gælder også. */
async function displayLinkIfNeeded(userId: string, sent: boolean): Promise<string | undefined> {
  if (sent && getEnv().EMAIL_PROVIDER !== "console") return undefined;
  const { token } = await createPasswordToken(userId, "INVITE");
  return inviteUrl(token);
}

/**
 * Opret rådgiver (QA #1, #13). Idempotent: samme formular-nøgle giver samme resultat (ingen «findes allerede» ved
 * dobbeltklik), og invitationslinket går ikke tabt. Nye rådgivere oprettes inaktive (se aktivering i admin).
 */
export async function createAdvisorAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const admin = await requireRole("ADMIN");
  const values = {
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    title: String(formData.get("title") ?? "").trim(),
  };
  const parsed = z
    .object({
      name: z.string().min(2, "Indtast navn (mindst 2 tegn)."),
      email: z.string().toLowerCase().email("Indtast en gyldig e-mailadresse."),
      title: z.string().max(120, "Titlen må højst være 120 tegn."),
    })
    .safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ugyldige felter.", values };
  const data = parsed.data;
  let outcome;
  try {
    outcome = await withIdempotency<{ ok: true; userId: string; name: string; email: string; sent: boolean } | { ok: false; error: string }>({ userId: admin.id, scope: "advisor.create", key: formData.get("idem") }, async () => {
      if (await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } })) {
        return { ok: false, error: "Der findes allerede en bruger med den e-mail." };
      }
      const user = await prisma.user.create({
        data: { name: data.name, email: data.email, role: "ADVISOR", advisorProfile: { create: { title: data.title, active: false } } },
      });
      await audit(admin.id, "advisor.create", "User", user.id);
      const { token } = await createPasswordToken(user.id, "INVITE");
      const sent = await sendInviteEmail(user, token);
      await audit(admin.id, "advisor.invite", "User", user.id);
      return { ok: true, userId: user.id, name: user.name, email: user.email, sent };
    });
  } catch (e) {
    if (e instanceof IdempotencyInFlightError) return { error: e.message, values };
    throw e;
  }
  const r = outcome.result;
  if (!r.ok) return { error: r.error, values };
  revalidatePath("/admin/advisors");
  const inviteLink = await displayLinkIfNeeded(r.userId, r.sent);
  return {
    ok: r.sent ? `${r.name} er oprettet (inaktiv), og invitationen er sendt til ${r.email}.` : `${r.name} er oprettet (inaktiv). Mailen kunne ikke sendes – brug linket herunder.`,
    inviteLink,
  };
}

export async function resendInviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const admin = await requireRole("ADMIN");
  const user = await prisma.user.findFirst({ where: { id: String(formData.get("userId")), role: "ADVISOR" } });
  if (!user) return { error: "Rådgiveren findes ikke." };
  const { token } = await createPasswordToken(user.id, "INVITE");
  const sent = await sendInviteEmail(user, token);
  await audit(admin.id, "advisor.invite", "User", user.id);
  return { ok: sent ? `Ny invitation sendt til ${user.email}.` : "Mailen kunne ikke sendes – brug linket.", inviteLink: await displayLinkIfNeeded(user.id, sent) };
}

export interface ActivationState {
  ok?: string;
  error?: string;
  /** Tidsstempel for svaret, så samme besked to gange stadig vises/annonceres */
  at?: number;
}

/**
 * Aktivér/deaktivér med en dedikeret knap, der gemmer straks (QA #13). `active` er den ønskede tilstand. Aktivering
 * afvises på serveren, indtil tjeklisten er opfyldt (se `setAdvisorActive`); deaktivering er altid tilladt.
 */
export async function setAdvisorActiveAction(_prev: ActivationState, formData: FormData): Promise<ActivationState> {
  const admin = await requireRole("ADMIN");
  const id = String(formData.get("userId") ?? "");
  const want = String(formData.get("active") ?? "");
  if (want !== "true" && want !== "false") return { error: "Ugyldig handling.", at: Date.now() };
  const r = await setAdvisorActive(admin.id, id, want === "true");
  revalidatePath("/admin/advisors");
  revalidatePath(`/admin/advisors/${id}`);
  return r.ok ? { ok: r.message, at: Date.now() } : { error: r.error, at: Date.now() };
}

/**
 * Admin retter rådgiverens profil (titel, bio, foto-URL, mobilnummer) med samme validering som rådgiverens egen
 * formular. Rådgiveren kan stadig selv rette felterne under Min profil. Audit-logges med de ændrede feltnavne.
 */
export async function updateAdvisorProfileByAdminAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const values = formValues(formData);
  const id = String(formData.get("userId") ?? "");
  const user = await prisma.user.findFirst({ where: { id, role: "ADVISOR" }, include: { advisorProfile: true } });
  if (!user?.advisorProfile) return { error: "Rådgiveren findes ikke.", values };
  const parsed = parseAdvisorProfile(values);
  if (!parsed.ok) return { error: parsed.error, values };
  const d = parsed.data;
  const before = { title: user.advisorProfile.title, bio: user.advisorProfile.bio, photoUrl: user.advisorProfile.photoUrl, phone: user.phone };
  const changed = (Object.keys(before) as (keyof typeof before)[]).filter((k) => before[k] !== d[k]);
  if (changed.length === 0) return { ok: "Ingen ændringer at gemme.", values };
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { phone: d.phone } }),
    prisma.advisorProfile.update({ where: { userId: id }, data: { title: d.title, bio: d.bio, photoUrl: d.photoUrl } }),
  ]);
  await audit(admin.id, "advisor.profile.update", "User", id, `Felter: ${changed.join(",")}`);
  revalidatePath("/admin/advisors");
  revalidatePath(`/admin/advisors/${id}`);
  return { ok: `Profilen er gemt. ${user.name} kan se og rette ændringerne under Min profil.`, values: { ...values, phone: d.phone ?? "" } };
}

export async function processJobsAction() {
  const admin = await requireRole("ADMIN");
  const n = await processJobs(10);
  await audit(admin.id, "jobs.process", "Job", "manual");
  redirectWith("/admin", "ok", `${n} baggrundsjob behandlet.`);
}

export async function processDeletionAction(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const id = String(formData.get("userId"));
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role === "ADMIN") redirectWith("/admin/customers", "err", "Kan ikke slette denne bruger.");
  if (!user.deletionRequestedAt) redirectWith("/admin/customers", "err", "Brugeren har ikke anmodet om sletning.");
  // Opsiger abonnementet hos udbyderen, sletter optagelser i lageret og webhook-data, og derefter kontoen (M-3)
  const r = await eraseUser(id, admin.id);
  if (!r.ok) redirectWith("/admin/customers", "err", r.error);
  redirectWith("/admin/customers", "ok", "Brugeren og tilhørende data er slettet, og abonnementet er opsagt.");
}

/** Prisinterval for rådgivere (plan #20). */
export async function savePriceBoundsAction(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const b = { min: Number(String(formData.get("min") ?? "").replace(/\D/g, "")), max: Number(String(formData.get("max") ?? "").replace(/\D/g, "")) };
  const problem = validatePriceBounds(b);
  if (problem) redirectWith("/admin/advisors", "err", problem);
  await savePriceBounds(b);
  await audit(admin.id, "advisor.price_bounds", "AppSetting", "advisor.price", `${b.min}-${b.max}`);
  redirectWith("/admin/advisors", "ok", "Prisintervallet er gemt. Det gælder for nye prisændringer.");
}

/** Slå en helligdag/lukkedag til eller fra for booking (plan #24). */
export async function setHolidayBlockedAction(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const date = String(formData.get("date") ?? "");
  const blocked = formData.get("blocked") === "1";
  try {
    await setHolidayBlocked(date, blocked);
  } catch {
    redirectWith("/admin/helligdage", "err", "Datoen er ikke en kendt helligdag.");
  }
  await audit(admin.id, blocked ? "holiday.block" : "holiday.open", "AppSetting", date);
  revalidatePath("/admin/helligdage");
  redirectWith("/admin/helligdage", "ok", blocked ? `${date} er spærret for booking.` : `${date} er åbnet for booking.`);
}
