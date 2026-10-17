"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { recordingConsentNow, safeNextPath } from "@/lib/consent";
import { currentConsent } from "@/lib/content/server";
import { withdrawMarketingForUser } from "@/lib/leads";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirectWith } from "@/lib/redirect";

export async function requestDeletionAction() {
  const user = await requireUser();
  if (user.role === "ADMIN") redirectWith("/account", "err", "Administratorkonti kan ikke slettes her.");
  await prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: new Date() } });
  await audit(user.id, "user.deletion_request", "User", user.id);
  redirectWith("/account", "ok", "Din anmodning om sletning er registreret. Vi behandler den hurtigst muligt og senest inden for 30 dage.");
}

export async function cancelDeletionRequestAction() {
  const user = await requireUser();
  await prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: null } });
  await audit(user.id, "user.deletion_request_withdrawn", "User", user.id);
  redirectWith("/account", "ok", "Anmodningen om sletning er trukket tilbage.");
}

/** Engangs-accept af optagelse og transskription (eksisterende brugere uden registreret samtykke). */
export async function acceptRecordingConsentAction(formData: FormData) {
  const user = await requireUser();
  if (formData.get("recordingConsent") !== "on") {
    redirectWith("/samtykke", "err", "Sæt kryds for at give samtykke, eller log ud, hvis du ikke ønsker at deltage i optagne møder.");
  }
  await prisma.user.update({ where: { id: user.id }, data: recordingConsentNow((await currentConsent("recording")).version) });
  await audit(user.id, "user.recording_consent", "User", user.id);
  const next = safeNextPath(String(formData.get("next") ?? ""));
  redirect(next ?? (user.role === "ADMIN" ? "/admin" : "/dashboard"));
}

/** Til/fra for e-mail og SMS under Konto. Gælder alt undtagen kontobeskeder (invitation, nulstilling). */
export async function saveNotificationPreferencesAction(formData: FormData) {
  const user = await requireUser();
  const email = formData.get("email") === "on";
  const sms = formData.get("sms") === "on";
  // Markedsføring (samtykke fra tilmeldingen): kan kun trækkes tilbage her
  if (formData.get("marketing") !== "on") await withdrawMarketingForUser(user.id, { email: true, sms: true });
  await prisma.user.update({
    where: { id: user.id },
    data: { emailOptOutAt: email ? null : (user.emailOptOutAt ?? new Date()), smsOptOutAt: sms ? null : (user.smsOptOutAt ?? new Date()) },
  });
  await audit(user.id, "user.notification_preferences", "User", user.id);
  redirectWith("/account", "ok", "Dine indstillinger for beskeder er gemt.");
}
