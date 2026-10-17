import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { MatchAdvisor, MatchAnswer } from "../matching";

/** Serialiserbar rådgiver til board-builderen (klient) og matching. */
export interface BuilderAdvisor {
  id: string;
  name: string;
  title: string;
  bio: string;
  photoUrl: string;
  priceDkk: number;
  tags: { id: string; name: string }[];
}

export interface BuilderTag {
  id: string;
  name: string;
}

/** `includeIds`: rådgivere, der skal med, selv om de er inaktive (admin ser et eksisterende board). */
export async function loadCatalog(opts: { includeIds?: string[] } = {}): Promise<{ advisors: BuilderAdvisor[]; tags: BuilderTag[] }> {
  const [profiles, tags] = await Promise.all([
    prisma.advisorProfile.findMany({
      where: opts.includeIds?.length ? { OR: [{ active: true }, { userId: { in: opts.includeIds } }] } : { active: true },
      include: { user: true, tags: { include: { tag: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.tag.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  return {
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    advisors: profiles.map((p) => ({
      id: p.userId,
      name: p.user.name,
      title: p.title,
      bio: p.bio,
      photoUrl: p.photoUrl,
      priceDkk: p.pricePerMeetingDkk,
      tags: p.tags
        .filter((t) => t.tag.active)
        .sort((a, b) => a.tag.sortOrder - b.tag.sortOrder || a.tag.name.localeCompare(b.tag.name, "da"))
        .map((t) => ({ id: t.tag.id, name: t.tag.name })),
    })),
  };
}

export function toMatchAdvisors(advisors: BuilderAdvisor[]): MatchAdvisor[] {
  return advisors.map((a) => ({ id: a.id, name: a.name, priceDkk: a.priceDkk, active: true, tagIds: a.tags.map((t) => t.id) }));
}

const questionInclude = {
  answers: { orderBy: { sortOrder: "asc" as const }, include: { weights: true } },
} satisfies Prisma.OnboardingQuestionInclude;

export type QuestionWithAnswers = Prisma.OnboardingQuestionGetPayload<{ include: typeof questionInclude }>;

/** Aktive spørgsmål i rækkefølge (med mindst ét svar). Kun aktive tags tæller med i vægtene. */
export async function loadActiveQuestions(): Promise<QuestionWithAnswers[]> {
  const qs = await prisma.onboardingQuestion.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: questionInclude,
  });
  return qs.filter((q) => q.answers.length > 0);
}

export async function loadAllQuestions(): Promise<QuestionWithAnswers[]> {
  return prisma.onboardingQuestion.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: questionInclude });
}

/** Oversætter valgte svar-id'er til matching-input; ignorerer ukendte svar og inaktive tags. */
export function selectedMatchAnswers(
  questions: QuestionWithAnswers[],
  selected: Record<string, string[]>,
  activeTagIds: Set<string>,
): MatchAnswer[] {
  const out: MatchAnswer[] = [];
  for (const q of questions) {
    for (const a of q.answers) {
      if (!(selected[q.id] ?? []).includes(a.id)) continue;
      out.push({
        boardSize: a.boardSize,
        tagWeights: a.weights.filter((w) => activeTagIds.has(w.tagId)).map((w) => ({ tagId: w.tagId, weight: w.weight })),
      });
    }
  }
  return out;
}
