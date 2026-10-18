"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formValues, type FormState } from "@/lib/form-state";
import { advisorOwnProfileSchema, profilePhone } from "@/lib/advisor-profile";
import { overlapsExistingRule } from "@/lib/availability-rules";
import { hhmmToMinutes, parseDanishDateTime } from "@/lib/time";

/** Rådgiverens profil. Beholder indtastningerne ved fejl (plan #22). */
export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("ADVISOR");
  const values = formValues(formData);
  const parsed = advisorOwnProfileSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ugyldige felter.", values };
  const ph = profilePhone(parsed.data.phone);
  if ("error" in ph) return { error: ph.error, values };
  const phone = ph.phone;
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { name: parsed.data.name, phone } }),
    prisma.advisorProfile.update({
      where: { userId: user.id },
      data: { title: parsed.data.title, bio: parsed.data.bio },
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
