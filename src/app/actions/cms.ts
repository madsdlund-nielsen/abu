"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
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

/** Sætter (1-5) eller fjerner (null) et tags vægt på et svar. */
export async function setAnswerWeightAction(answerId: string, tagId: string, weight: number | null): R {
  return guard(async (adminId) => {
    if (weight === null) {
      await prisma.answerTagWeight.deleteMany({ where: { answerId, tagId } });
    } else {
      if (!Number.isInteger(weight) || weight < 1 || weight > 5) return err("Vægten skal være mellem 1 og 5.");
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

export async function createTagAction(input: { name: string; description?: string }): R<{ id: string }> {
  const admin = await requireRole("ADMIN");
  const p = z.object({ name: text(60, 2), description: z.string().trim().max(200).optional() }).safeParse(input);
  if (!p.success) return err(p.error.issues[0].message);
  let slug = slugify(p.data.name) || "tag";
  if (await prisma.tag.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const last = await prisma.tag.aggregate({ _max: { sortOrder: true } });
  const t = await prisma.tag.create({
    data: { name: p.data.name, slug, description: p.data.description || null, sortOrder: (last._max.sortOrder ?? 0) + 10 },
  });
  await audit(admin.id, "tag.create", "Tag", t.id);
  refresh();
  return { ok: true, id: t.id };
}

export async function updateTagAction(id: string, patch: { name?: string; description?: string; active?: boolean }): R {
  return guard(async (adminId) => {
    const p = z.object({ name: text(60, 2).optional(), description: z.string().trim().max(200).optional(), active: z.boolean().optional() }).safeParse(patch);
    if (!p.success) return err(p.error.issues[0].message);
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

export async function updateAdvisorAction(userId: string, input: { priceDkk: number; active: boolean; tagIds: string[] }): R {
  return guard(async (adminId) => {
    const p = z
      .object({
        priceDkk: z.number().int("Prisen skal være et helt antal kroner.").min(0, "Prisen kan ikke være negativ.").max(20000, "Prisen er urealistisk høj."),
        active: z.boolean(),
        tagIds: z.array(z.string()).max(30),
      })
      .safeParse(input);
    if (!p.success) return err(p.error.issues[0].message);
    const exists = await prisma.advisorProfile.findUnique({ where: { userId } });
    if (!exists) return err("Rådgiveren findes ikke.");
    const tagCount = await prisma.tag.count({ where: { id: { in: p.data.tagIds } } });
    if (tagCount !== new Set(p.data.tagIds).size) return err("Et af tagsene findes ikke.");
    await prisma.$transaction([
      prisma.advisorProfile.update({ where: { userId }, data: { pricePerMeetingDkk: p.data.priceDkk, active: p.data.active } }),
      prisma.advisorTag.deleteMany({ where: { advisorId: userId, tagId: { notIn: p.data.tagIds } } }),
      prisma.advisorTag.createMany({ data: [...new Set(p.data.tagIds)].map((tagId) => ({ advisorId: userId, tagId })), skipDuplicates: true }),
    ]);
    await audit(adminId, "advisor.update", "User", userId);
    refresh();
    revalidatePath(`/admin/advisors/${userId}`);
    return { ok: true };
  });
}
