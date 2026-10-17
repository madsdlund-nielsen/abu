"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formValues, type FormState } from "@/lib/form-state";
import { normalizePhone } from "@/lib/onboarding/schemas";
import { overlapsExistingRule } from "@/lib/availability-rules";
import { hhmmToMinutes, parseDanishDateTime } from "@/lib/time";

/** Rådgiverens profil. Beholder indtastningerne ved fejl (plan #22). */
export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("ADVISOR");
  const values = formValues(formData);
  const schema = z.object({
    name: z.string().trim().min(2, "Indtast dit navn (mindst 2 tegn)."),
    title: z.string().trim().max(120, "Titlen må højst være 120 tegn."),
    bio: z.string().trim().max(4000, "Præsentationen må højst være 4.000 tegn."),
    phone: z.string().trim().max(30).optional(),
    photoUrl: z.string().trim().max(500).refine((v) => v === "" || /^https:\/\//.test(v), "Foto-URL skal starte med https://"),
  });
  const parsed = schema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ugyldige felter.", values };
  const phoneRaw = parsed.data.phone ?? "";
  const phone = phoneRaw === "" ? null : normalizePhone(phoneRaw);
  if (phoneRaw !== "" && !phone) return { error: "Indtast et gyldigt telefonnummer, fx 20 30 40 50 eller +46 70 123 45 67.", values };
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { name: parsed.data.name, phone } }),
    prisma.advisorProfile.update({
      where: { userId: user.id },
      data: { title: parsed.data.title, bio: parsed.data.bio, photoUrl: parsed.data.photoUrl },
    }),
  ]);
  revalidatePath("/profile");
  return { ok: "Profilen er gemt.", values };
}

export async function addRuleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("ADVISOR");
  const values = formValues(formData);
  const weekday = Number(formData.get("weekday"));
  const start = hhmmToMinutes(String(formData.get("start") ?? ""));
  const end = hhmmToMinutes(String(formData.get("end") ?? ""));
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return { error: "Vælg en ugedag.", values, at: Date.now() };
  if (start === null || end === null || start >= end) return { error: "Sluttidspunkt skal være efter starttidspunkt.", values, at: Date.now() };
  const existing = await prisma.availabilityRule.findMany({ where: { advisorId: user.id }, select: { weekday: true, startMinute: true, endMinute: true } });
  if (overlapsExistingRule(existing, { weekday, startMinute: start, endMinute: end })) {
    return { error: "Tidsrummet overlapper et eksisterende tidsrum samme ugedag.", values, at: Date.now() };
  }
  await prisma.availabilityRule.create({ data: { advisorId: user.id, weekday, startMinute: start, endMinute: end } });
  revalidatePath("/availability");
  return { ok: "Tidsrummet er tilføjet.", at: Date.now() };
}

export async function deleteRuleAction(formData: FormData) {
  const user = await requireRole("ADVISOR");
  await prisma.availabilityRule.deleteMany({ where: { id: String(formData.get("id")), advisorId: user.id } });
  revalidatePath("/availability");
}

/**
 * Fravær. Dato som "dd.mm.åååå" og klokkeslæt som "HH:mm" (København-tid). Slut kan være 24:00 (hele dagen, plan #24),
 * som gemmes som midnat dagen efter.
 */
export async function addBlockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("ADVISOR");
  const values = formValues(formData);
  const startsAt = parseDanishDateTime(String(formData.get("fromDate") ?? ""), String(formData.get("fromTime") ?? ""));
  const endsAt = parseDanishDateTime(String(formData.get("toDate") ?? ""), String(formData.get("toTime") ?? ""), { allowEndOfDay: true });
  if (!startsAt || !endsAt) return { error: "Angiv fra og til som dd.mm.åååå og klokkeslæt.", values, at: Date.now() };
  if (endsAt <= startsAt) return { error: "Slut skal være efter start.", values, at: Date.now() };
  await prisma.availabilityBlock.create({
    data: { advisorId: user.id, startsAt, endsAt, reason: String(formData.get("reason") ?? "").slice(0, 200) },
  });
  revalidatePath("/availability");
  return { ok: "Fraværet er tilføjet.", at: Date.now() };
}

export async function deleteBlockAction(formData: FormData) {
  const user = await requireRole("ADVISOR");
  await prisma.availabilityBlock.deleteMany({ where: { id: String(formData.get("id")), advisorId: user.id } });
  revalidatePath("/availability");
}
