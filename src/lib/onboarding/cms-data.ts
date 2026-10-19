import { prisma } from "../db";
import { LEAD_TAG_KEY } from "../lead";
import type { CmsAdvisor, CmsQuestion, CmsTag } from "./cms-types";

/**
 * Data til onboarding-CMS'et og tag-siden. Som standard kun kompetence-tags (admin-tags bruges aldrig i matching, vægte
 * eller dækning); `includeAdmin` tager også de interne tags med (kun /admin/tags).
 */
export async function loadCmsData(opts: { includeAdmin?: boolean } = {}): Promise<{ questions: CmsQuestion[]; tags: CmsTag[]; advisors: CmsAdvisor[] }> {
  const [questions, tags, advisors, weightCounts] = await Promise.all([
    prisma.onboardingQuestion.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { answers: { orderBy: { sortOrder: "asc" }, include: { weights: true } } },
    }),
    prisma.tag.findMany({ where: opts.includeAdmin ? {} : { kind: "COMPETENCE" }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }),
    prisma.advisorProfile.findMany({ where: { active: true }, include: { user: true, tags: { include: { tag: { select: { systemKey: true } } } } }, orderBy: { user: { name: "asc" } } }),
    prisma.answerTagWeight.groupBy({ by: ["tagId"], _count: { _all: true } }),
  ]);
  const competence = new Set(tags.filter((t) => t.kind === "COMPETENCE").map((t) => t.id));
  const answersByTag = new Map(weightCounts.map((w) => [w.tagId, w._count._all]));
  const advisorsByTag = new Map<string, number>();
  for (const a of advisors) for (const t of a.tags) advisorsByTag.set(t.tagId, (advisorsByTag.get(t.tagId) ?? 0) + 1);
  return {
    questions: questions.map((q) => ({
      id: q.id,
      text: q.text,
      helpText: q.helpText ?? "",
      type: q.type,
      active: q.active,
      answers: q.answers.map((a) => ({
        id: a.id,
        text: a.text,
        boardSize: a.boardSize,
        weights: a.weights.map((w) => ({ tagId: w.tagId, weight: w.weight })).sort((x, y) => y.weight - x.weight || x.tagId.localeCompare(y.tagId)),
      })),
    })),
    tags: tags.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description ?? "",
      active: t.active,
      kind: t.kind,
      system: t.systemKey !== null,
      advisors: advisorsByTag.get(t.id) ?? 0,
      answers: answersByTag.get(t.id) ?? 0,
    })),
    advisors: advisors.map((a) => ({ id: a.userId, name: a.user.name, priceDkk: a.pricePerMeetingDkk, tagIds: a.tags.map((t) => t.tagId).filter((id) => competence.has(id)), leadEligible: a.tags.some((t) => t.tag.systemKey === LEAD_TAG_KEY) })),
  };
}
