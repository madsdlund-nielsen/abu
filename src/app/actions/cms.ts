"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPriceBounds, validateAdvisorPrice } from "@/lib/advisor-price";
import { isDuplicateTagName } from "@/lib/tag-name";
import { fillMissingLeads, getLeadTagId, LEAD_TAG_KEY, reassignLeadsFrom } from "@/lib/lead";
import type { ActionResult } from "@/lib/onboarding/cms-types";

type R<T = object> = Promise<ActionResult<T>>;

const err = (error: string) => ({ ok: false as const, error });
const refresh = () => {
  revalidatePath("/admin/onboarding");
  revalidatePath("/admin/tags");
  revalidatePath("/admin/advisors");
};

async function guard(fn: (adminId: string) => Promise<ActionResult<never> | ActionResult<object>>): R<never> {
  const admin = await requireRole("ADMIN");
  try {
    return (await fn(admin.id)) as ActionResult<never>;
  } catch (e) {
    console.error("[cms] fejl", e);
    return err("Ændringen kunne ikke gemmes. Prøv igen.");
  }
}

const text = (max: number, min = 1) => z.string().trim().min(min, "Teksten må ikke være tom.").max(max, "Teksten er for lang.");

// ---------------------------------------------------------------- Spørgsmål

export async function createQuestionAction(input: { text: string; type: "SINGLE" | "MULTI" }): R<{ id: string }> {
  const admin = await requireRole("ADMIN");
  const p = z.object({ text: text(300), type: z.enum(["SINGLE", "MULTI"]) }).safeParse(input);
  if (!p.success) return err(p.error.issues[0].message);
  const last = await prisma.onboardingQuestion.aggregate({ _max: { sortOrder: true } });
  const q = await prisma.onboardingQuestion.create({
    data: { text: p.data.text, type: p.data.type, active: false, sortOrder: (last._max.sortOrder ?? 0) + 10 },
  });
  await audit(admin.id, "onboarding.question.create", "OnboardingQuestion", q.id);
  refresh();
  return { ok: true, id: q.id };
}

export async function updateQuestionAction(
  id: string,
  patch: { text?: string; helpText?: string; type?: "SINGLE" | "MULTI"; active?: boolean },
): R {
  return guard(async (adminId) => {
    const p = z
      .object({ text: text(300).optional(), helpText: z.string().trim().max(500).optional(), type: z.enum(["SINGLE", "MULTI"]).optional(), active: z.boolean().optional() })
      .safeParse(patch);
    if (!p.success) return err(p.error.issues[0].message);
    if (p.data.active === true) {
      const n = await prisma.onboardingAnswer.count({ where: { questionId: id } });
      if (n < 2) return err("Et aktivt spørgsmål skal have mindst 2 svar. Tilføj svar, og aktivér derefter.");
    }
    await prisma.onboardingQuestion.update({
      where: { id },
      data: { ...p.data, ...(p.data.helpText !== undefined && { helpText: p.data.helpText || null }) },
    });
    await audit(adminId, `onboarding.question.update${p.data.active !== undefined ? (p.data.active ? ".activate" : ".deactivate") : ""}`, "OnboardingQuestion", id);
    refresh();
    return { ok: true };
  });
}

export async function deleteQuestionAction(id: string): R {
  return guard(async (adminId) => {
    // Gennemførte tests gemmer et snapshot af tekster, så historikken bevares.
    await prisma.onboardingQuestion.delete({ where: { id } });
    await audit(adminId, "onboarding.question.delete", "OnboardingQuestion", id);
    refresh();
    return { ok: true };
  });
}

export async function reorderQuestionsAction(ids: string[]): R {
  return guard(async (adminId) => {
    await prisma.$transaction(ids.map((id, i) => prisma.onboardingQuestion.update({ where: { id }, data: { sortOrder: (i + 1) * 10 } })));
    await audit(adminId, "onboarding.question.reorder", "OnboardingQuestion", "all");
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- Svar

export async function createAnswerAction(questionId: string, input: { text: string }): R<{ id: string }> {
  const admin = await requireRole("ADMIN");
  const p = text(300).safeParse(input.text);
  if (!p.success) return err(p.error.issues[0].message);
  const last = await prisma.onboardingAnswer.aggregate({ where: { questionId }, _max: { sortOrder: true } });
  const a = await prisma.onboardingAnswer.create({ data: { questionId, text: p.data, sortOrder: (last._max.sortOrder ?? 0) + 10 } });
  await audit(admin.id, "onboarding.answer.create", "OnboardingAnswer", a.id);
  refresh();
  return { ok: true, id: a.id };
}

export async function updateAnswerAction(id: string, patch: { text?: string; boardSize?: number | null }): R {
  return guard(async (adminId) => {
    const p = z.object({ text: text(300).optional(), boardSize: z.union([z.literal(2), z.literal(3), z.literal(4), z.null()]).optional() }).safeParse(patch);
    if (!p.success) return err(p.error.issues[0].message);
    await prisma.onboardingAnswer.update({ where: { id }, data: p.data });
    await audit(adminId, "onboarding.answer.update", "OnboardingAnswer", id);
    refresh();
    return { ok: true };
  });
}

export async function deleteAnswerAction(id: string): R {
  return guard(async (adminId) => {
    await prisma.onboardingAnswer.delete({ where: { id } });
    await audit(adminId, "onboarding.answer.delete", "OnboardingAnswer", id);
    refresh();
    return { ok: true };
  });
}

export async function reorderAnswersAction(ids: string[]): R {
  return guard(async (adminId) => {
    await prisma.$transaction(ids.map((id, i) => prisma.onboardingAnswer.update({ where: { id }, data: { sortOrder: (i + 1) * 10 } })));
    await audit(adminId, "onboarding.answer.reorder", "OnboardingAnswer", ids[0] ?? "none");
    refresh();
    return { ok: true };
  });
}

/** Sætter (1-5) eller fjerner (null) et tags vægt på et svar. Kun kompetence-tags (interne tags bruges aldrig i matchingen). */
export async function setAnswerWeightAction(answerId: string, tagId: string, weight: number | null): R {
  return guard(async (adminId) => {
    if (weight === null) {
      await prisma.answerTagWeight.deleteMany({ where: { answerId, tagId } });
    } else {
      if (!Number.isInteger(weight) || weight < 1 || weight > 5) return err("Vægten skal være mellem 1 og 5.");
      const tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { kind: true } });
      if (!tag) return err("Tagget findes ikke.");
      if (tag.kind !== "COMPETENCE") return err("Interne tags kan ikke bruges i onboarding-testen.");
      await prisma.answerTagWeight.upsert({
        where: { answerId_tagId: { answerId, tagId } },
        update: { weight },
        create: { answerId, tagId, weight },
      });
    }
    await audit(adminId, weight === null ? "onboarding.weight.remove" : "onboarding.weight.set", "OnboardingAnswer", answerId);
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- Tags

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createTagAction(input: { name: string; description?: string; kind?: "COMPETENCE" | "ADMIN" }): R<{ id: string }> {
  const admin = await requireRole("ADMIN");
  const p = z.object({ name: text(60, 2), description: z.string().trim().max(200).optional(), kind: z.enum(["COMPETENCE", "ADMIN"]).default("COMPETENCE") }).safeParse(input);
  if (!p.success) return err(p.error.issues[0].message);
  const names = await prisma.tag.findMany({ select: { name: true } });
  if (isDuplicateTagName(names.map((n) => n.name), p.data.name)) return err("Der findes allerede et tag med det navn.");
  let slug = slugify(p.data.name) || "tag";
  if (await prisma.tag.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const last = await prisma.tag.aggregate({ _max: { sortOrder: true } });
  const t = await prisma.tag.create({
    data: { name: p.data.name, slug, description: p.data.description || null, sortOrder: (last._max.sortOrder ?? 0) + 10, kind: p.data.kind },
  });
  await audit(admin.id, "tag.create", "Tag", t.id, p.data.kind === "ADMIN" ? "Internt tag" : undefined);
  refresh();
  return { ok: true, id: t.id };
}

export async function updateTagAction(id: string, patch: { name?: string; description?: string; active?: boolean }): R {
  return guard(async (adminId) => {
    const p = z.object({ name: text(60, 2).optional(), description: z.string().trim().max(200).optional(), active: z.boolean().optional() }).safeParse(patch);
    if (!p.success) return err(p.error.issues[0].message);
    const current = await prisma.tag.findUnique({ where: { id }, select: { systemKey: true } });
    if (!current) return err("Tagget findes ikke.");
    if (current.systemKey && p.data.active === false) return err("Systemtagget kan ikke deaktiveres. Fjern det i stedet fra de rådgivere, der ikke skal have det.");
    if (p.data.name !== undefined) {
      const others = await prisma.tag.findMany({ where: { id: { not: id } }, select: { name: true } });
      if (isDuplicateTagName(others.map((n) => n.name), p.data.name)) return err("Der findes allerede et tag med det navn.");
    }
    await prisma.tag.update({
      where: { id },
      data: { ...p.data, ...(p.data.description !== undefined && { description: p.data.description || null }) },
    });
    await audit(adminId, `tag.update${p.data.active !== undefined ? (p.data.active ? ".activate" : ".deactivate") : ""}`, "Tag", id);
    refresh();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- Rådgivere

/** Pris og tags. Aktiv/inaktiv ændres kun via `setAdvisorActiveAction` (tjeklisten håndhæves dér); et `active`-felt ignoreres. */
export async function updateAdvisorAction(userId: string, input: { priceDkk: number; tagIds: string[] }): R {
  return guard(async (adminId) => {
    const p = z
      .object({
        priceDkk: z.number().int("Prisen skal være et helt antal kroner."),
        tagIds: z.array(z.string()).max(30),
      })
      .safeParse(input);
    if (!p.success) return err(p.error.issues[0].message);
    const priceProblem = validateAdvisorPrice(p.data.priceDkk, await getPriceBounds());
    if (priceProblem) return err(priceProblem);
    const exists = await prisma.advisorProfile.findUnique({ where: { userId } });
    if (!exists) return err("Rådgiveren findes ikke.");
    const tagCount = await prisma.tag.count({ where: { id: { in: p.data.tagIds } } });
    const hadLeadTag = (await prisma.advisorTag.count({ where: { advisorId: userId, tag: { systemKey: LEAD_TAG_KEY } } })) > 0;
    if (tagCount !== new Set(p.data.tagIds).size) return err("Et af tagsene findes ikke.");
    await prisma.$transaction([
      prisma.advisorProfile.update({ where: { userId }, data: { pricePerMeetingDkk: p.data.priceDkk } }),
      prisma.advisorTag.deleteMany({ where: { advisorId: userId, tagId: { notIn: p.data.tagIds } } }),
      prisma.advisorTag.createMany({ data: [...new Set(p.data.tagIds)].map((tagId) => ({ advisorId: userId, tagId })), skipDuplicates: true }),
    ]);
    await audit(adminId, "advisor.update", "User", userId);
    // Lead-tagget fjernet → nye ansvarlige for rådgiverens boards; tilføjet → boards uden ansvarlig kan få én
    const leadTagId = await getLeadTagId();
    if (hadLeadTag && !p.data.tagIds.includes(leadTagId)) await reassignLeadsFrom(userId, "tag_removed", adminId);
    if (!hadLeadTag && p.data.tagIds.includes(leadTagId)) await fillMissingLeads(userId, adminId);
    refresh();
    revalidatePath(`/admin/advisors/${userId}`);
    return { ok: true };
  });
}
