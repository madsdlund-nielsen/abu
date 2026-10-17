"use server";

import { z } from "zod";
import { audit } from "@/lib/audit";
import { createPasswordToken, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendInviteEmail, inviteUrl } from "@/lib/emails";
import { getEnv } from "@/lib/env";
import { processJobs } from "@/lib/jobs";
import { deleteOnboardingSessionsForEmail } from "@/lib/onboarding/session";
import { redirectWith } from "@/lib/redirect";

async function inviteAndReport(userId: string, email: string, name: string, back: string, actorId: string): Promise<never> {
  const { token } = await createPasswordToken(userId, "INVITE");
  const sent = await sendInviteEmail(email, name, token);
  await audit(actorId, "advisor.invite", "User", userId);
  const showLink = !sent || getEnv().EMAIL_PROVIDER === "console";
  const sep = back.includes("?") ? "&" : "?";
  if (showLink) {
    const note = sent ? "" : " (mailen kunne ikke sendes)";
    const { redirect } = await import("next/navigation");
    redirect(
      `${back}${sep}ok=${encodeURIComponent(`Invitation oprettet for ${name}${note}.`)}&invite=${encodeURIComponent(inviteUrl(token))}`,
    );
  }
  redirectWith(back, "ok", `Invitation sendt til ${email}.`);
}

export async function createAdvisorAction(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Indtast navn."),
      email: z.string().trim().toLowerCase().email("Ugyldig e-mail."),
      title: z.string().trim().max(120).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirectWith("/admin/advisors/new", "err", parsed.error.issues[0]?.message ?? "Ugyldige felter.");
  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) redirectWith("/admin/advisors/new", "err", "Der findes allerede en bruger med den e-mail.");
  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      role: "ADVISOR",
      advisorProfile: { create: { title: parsed.data.title ?? "" } },
    },
  });
  await audit(admin.id, "advisor.create", "User", user.id);
  await inviteAndReport(user.id, user.email, user.name, "/admin/advisors", admin.id);
}

export async function resendInviteAction(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const user = await prisma.user.findFirst({ where: { id: String(formData.get("userId")), role: "ADVISOR" } });
  if (!user) redirectWith("/admin/advisors", "err", "Rådgiveren findes ikke.");
  await inviteAndReport(user.id, user.email, user.name, "/admin/advisors", admin.id);
}

export async function toggleAdvisorActiveAction(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const id = String(formData.get("userId"));
  const profile = await prisma.advisorProfile.findUnique({ where: { userId: id } });
  if (!profile) redirectWith("/admin/advisors", "err", "Rådgiveren findes ikke.");
  await prisma.advisorProfile.update({ where: { userId: id }, data: { active: !profile.active } });
  await audit(admin.id, profile.active ? "advisor.deactivate" : "advisor.activate", "User", id);
  redirectWith("/admin/advisors", "ok", profile.active ? "Rådgiveren er deaktiveret." : "Rådgiveren er aktiveret.");
}

export async function setBoardAction(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const subscriptionId = String(formData.get("subscriptionId"));
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) redirectWith("/admin/subscriptions", "err", "Abonnementet findes ikke.");
  const advisorIds = [...new Set(formData.getAll("advisorIds").map(String))];
  if (advisorIds.length !== sub.advisorCount) {
    redirectWith("/admin/subscriptions", "err", `Vælg præcis ${sub.advisorCount} rådgivere.`);
  }
  const profiles = await prisma.advisorProfile.findMany({ where: { userId: { in: advisorIds } } });
  if (profiles.length !== advisorIds.length) redirectWith("/admin/subscriptions", "err", "Ugyldig rådgiver.");
  // Rådgivere, der bliver på boardet, beholder deres fastfrosne pris; nye rådgivere får deres aktuelle pris. Månedsprisen ændres ikke.
  const kept = new Map((await prisma.subscriptionAdvisor.findMany({ where: { subscriptionId } })).map((a) => [a.advisorId, a.pricePerMeetingDkk]));
  await prisma.$transaction([
    prisma.subscriptionAdvisor.deleteMany({ where: { subscriptionId } }),
    prisma.subscriptionAdvisor.createMany({
      data: profiles.map((p) => ({ subscriptionId, advisorId: p.userId, pricePerMeetingDkk: kept.get(p.userId) ?? p.pricePerMeetingDkk })),
    }),
  ]);
  await audit(admin.id, "subscription.set_board", "Subscription", subscriptionId);
  redirectWith("/admin/subscriptions", "ok", "Boardet er opdateret.");
}

export async function processJobsAction() {
  const admin = await requireRole("ADMIN");
  const n = await processJobs(10);
  await audit(admin.id, "jobs.process", "Job", "manual");
  redirectWith("/admin", "ok", `${n} job(s) behandlet.`);
}

export async function processDeletionAction(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const id = String(formData.get("userId"));
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role === "ADMIN") redirectWith("/admin/customers", "err", "Kan ikke slette denne bruger.");
  if (!user.deletionRequestedAt) redirectWith("/admin/customers", "err", "Brugeren har ikke anmodet om sletning.");
  await audit(admin.id, "user.delete", "User", id);
  // Onboarding-data, der endnu ikke er slettet (genstartede tilmeldinger), fjernes sammen med brugeren.
  await deleteOnboardingSessionsForEmail(user.email);
  await prisma.user.delete({ where: { id } });
  redirectWith("/admin/customers", "ok", "Brugeren og tilhørende data er slettet.");
}
