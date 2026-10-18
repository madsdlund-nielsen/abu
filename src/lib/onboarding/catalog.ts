import type { Prisma } from "@prisma/client";
import { visibleAvatarVersion } from "../avatar-url";
import { prisma } from "../db";
import { leadEligibleIds } from "../lead";
import { userDirectory } from "../user-directory";
import type { MatchAdvisor, MatchAnswer } from "../matching";

/** Serialiserbar rådgiver til board-builderen (klient) og matching. */
export interface BuilderAdvisor {
  id: string;
  name: string;
  title: string;
  bio: string;
  /** Version af profilbilledet (`/api/avatar/<id>?v=…`), eller null = initialer */
  photo: string | null;
  priceDkk: number;
  /** Kun kompetence-tags (admin-tags vises aldrig for kunder) */
  tags: { id: string; name: string }[];
  /** Kan være ansvarlig rådgiver (har det interne lead-tag). Selve tagget sendes ikke til klienten. */
  leadEligible: boolean;
  /** Kun når admin ser et eksisterende board med en rådgiver, der er deaktiveret siden (kan ikke vælges på ny). */
  inactive?: boolean;
}

export interface BuilderTag {
  id: string;
  name: string;
}

/**
 * `includeIds`: rådgivere, der skal med, selv om de er inaktive (admin ser et eksisterende board). `viewer` afgør, om
 * inaktive rådgiveres fotos må vises (kun admin); aktive rådgiveres fotos er offentlige (også før login i onboardingen).
 */
export async function loadCatalog(opts: { includeIds?: string[]; viewer?: { id: string; role: string } | null } = {}): Promise<{ advisors: BuilderAdvisor[]; tags: BuilderTag[] }> {
  const [profiles, tags] = await Promise.all([
    prisma.advisorProfile.findMany({
      where: opts.includeIds?.length ? { OR: [{ active: true }, { userId: { in: opts.includeIds } }] } : { active: true },
      include: { tags: { include: { tag: true } } },
    }),
    prisma.tag.findMany({ where: { active: true, kind: "COMPETENCE" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  // RLS: rådgivernes navne via kataloget (rls.user_directory), og «kan være ansvarlig» via rls.lead_eligible_ids –
  // admin-tagget og User-rækkerne er ikke synlige før login (kun admin-tags filtreres her, som før)
  const ids = profiles.map((p) => p.userId);
  const [names, eligible] = await Promise.all([userDirectory(ids), leadEligibleIds(ids)]);
  const nameOf = (id: string) => names.get(id)?.name ?? "";
  return {
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    advisors: [...profiles]
      .sort((a, b) => nameOf(a.userId).localeCompare(nameOf(b.userId), "da") || a.userId.localeCompare(b.userId))
      .map((p) => ({
        id: p.userId,
        name: nameOf(p.userId),
        title: p.title,
        bio: p.bio,
        photo: visibleAvatarVersion({ id: p.userId, active: p.active, photoKey: p.photoKey, photoUpdatedAt: p.photoUpdatedAt }, opts.viewer),
        priceDkk: p.pricePerMeetingDkk,
        ...(p.active ? {} : { inactive: true }),
        leadEligible: p.active && eligible.has(p.userId),
        tags: p.tags
          .filter((t) => t.tag.active && t.tag.kind === "COMPETENCE")
          .sort((a, b) => a.tag.sortOrder - b.tag.sortOrder || a.tag.name.localeCompare(b.tag.name, "da"))
          .map((t) => ({ id: t.tag.id, name: t.tag.name })),
      })),
  };
}

export function toMatchAdvisors(advisors: BuilderAdvisor[]): MatchAdvisor[] {
  // Inaktive rådgivere foreslås aldrig (QA #13)
  return advisors.filter((a) => !a.inactive).map((a) => ({ id: a.id, name: a.name, priceDkk: a.priceDkk, active: true, tagIds: a.tags.map((t) => t.id), leadEligible: a.leadEligible }));
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
