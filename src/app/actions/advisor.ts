"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirectWith } from "@/lib/redirect";
import { normalizePhone } from "@/lib/onboarding/schemas";
import { overlapsExistingRule } from "@/lib/availability-rules";
import { hhmmToMinutes, parseDanishDateTime } from "@/lib/time";

export async function updateProfileAction(formData: FormData) {
  const user = await requireRole("ADVISOR");
  const schema = z.object({
    name: z.string().trim().min(2, "Indtast dit navn (mindst 2 tegn)."),
    title: z.string().trim().max(120),
    bio: z.string().trim().max(4000),
    phone: z.string().trim().max(30).optional(),
    photoUrl: z.string().trim().max(500).refine((v) => v === "" || /^https:\/\//.test(v), "Foto-URL skal starte med https://"),
  });
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirectWith("/profile", "err", parsed.error.issues[0]?.message ?? "Ugyldige felter.");
  const phoneRaw = parsed.data.phone ?? "";
  const phone = phoneRaw === "" ? null : normalizePhone(phoneRaw);
  if (phoneRaw !== "" && !phone) redirectWith("/profile", "err", "Indtast et gyldigt telefonnummer, fx 20 30 40 50 eller +46 70 123 45 67.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { name: parsed.data.name, phone } }),
    prisma.advisorProfile.update({
      where: { userId: user.id },
      data: { title: parsed.data.title, bio: parsed.data.bio, photoUrl: parsed.data.photoUrl },
    }),
  ]);
  redirectWith("/profile", "ok", "Profilen er gemt.");
}

export async function addRuleAction(formData: FormData) {
  const user = await requireRole("ADVISOR");
  const weekday = Number(formData.get("weekday"));
  const start = hhmmToMinutes(String(formData.get("start") ?? ""));
  const end = hhmmToMinutes(String(formData.get("end") ?? ""));
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) redirectWith("/availability", "err", "Vælg en ugedag.");
  if (start === null || end === null || start >= end) redirectWith("/availability", "err", "Sluttidspunkt skal være efter starttidspunkt.");
  const existing = await prisma.availabilityRule.findMany({ where: { advisorId: user.id }, select: { weekday: true, startMinute: true, endMinute: true } });
  if (overlapsExistingRule(existing, { weekday, startMinute: start, endMinute: end })) {
    redirectWith("/availability", "err", "Tidsrummet overlapper et eksisterende tidsrum samme ugedag.");
  }
  await prisma.availabilityRule.create({
    data: { advisorId: user.id, weekday, startMinute: start, endMinute: end },
  });
  redirectWith("/availability", "ok", "Tidsrummet er tilføjet.");
}

export async function deleteRuleAction(formData: FormData) {
  const user = await requireRole("ADVISOR");
  await prisma.availabilityRule.deleteMany({ where: { id: String(formData.get("id")), advisorId: user.id } });
  redirectWith("/availability", "ok", "Tidsrummet er fjernet.");
}

export async function addBlockAction(formData: FormData) {
  const user = await requireRole("ADVISOR");
  // Dato som "dd.mm.åååå" og klokkeslæt som "HH:mm", begge tolket som Europe/Copenhagen
  const startsAt = parseDanishDateTime(String(formData.get("fromDate") ?? ""), String(formData.get("fromTime") ?? ""));
  const endsAt = parseDanishDateTime(String(formData.get("toDate") ?? ""), String(formData.get("toTime") ?? ""));
  if (!startsAt || !endsAt) redirectWith("/availability", "err", "Angiv fra og til som dd.mm.åååå og klokkeslæt.");
  if (endsAt <= startsAt) redirectWith("/availability", "err", "Slut skal være efter start.");
  await prisma.availabilityBlock.create({
    data: { advisorId: user.id, startsAt, endsAt, reason: String(formData.get("reason") ?? "").slice(0, 200) },
  });
  redirectWith("/availability", "ok", "Fraværet er tilføjet.");
}

export async function deleteBlockAction(formData: FormData) {
  const user = await requireRole("ADVISOR");
  await prisma.availabilityBlock.deleteMany({ where: { id: String(formData.get("id")), advisorId: user.id } });
  redirectWith("/availability", "ok", "Fraværet er fjernet.");
}
