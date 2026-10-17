"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { createPasswordToken, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendInviteEmail, inviteUrl } from "@/lib/emails";
import { boardsWithAdvisor, loadReadiness, missingReadiness } from "@/lib/advisor-readiness";
import { getEnv } from "@/lib/env";
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

export async function toggleAdvisorActiveAction(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const id = String(formData.get("userId"));
  const profile = await prisma.advisorProfile.findUnique({ where: { userId: id }, include: { user: true } });
  if (!profile) redirectWith("/admin/advisors", "err", "Rådgiveren findes ikke.");
  const activate = !profile.active;
  await prisma.advisorProfile.update({ where: { userId: id }, data: { active: activate } });
  await audit(admin.id, activate ? "advisor.activate" : "advisor.deactivate", "User", id);
  revalidatePath("/admin/advisors");
  if (activate) {
    const missing = missingReadiness((await loadReadiness([id])).get(id) ?? []);
    redirectWith("/admin/advisors", "ok", `${profile.user.name} er aktiveret og kan nu vælges af kunder.${missing.length ? ` Bemærk: mangler ${missing.join(", ")}.` : ""}`);
  }
  const boards = await boardsWithAdvisor(id);
  redirectWith(
    "/admin/advisors",
    "ok",
    `${profile.user.name} er deaktiveret.${boards.length ? ` Berørte kunder (vælg en ny rådgiver under Abonnementer): ${boards.map((b) => b.companyName).join(", ")}.` : ""}`,
  );
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
