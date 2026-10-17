import type { CmsAdvisor, CmsQuestion, CmsTag } from "./cms-types";

export interface CmsWarning {
  scope: "question" | "answer" | "tag";
  /** spørgsmåls-, svar- eller tag-id */
  id: string;
  questionId?: string;
  message: string;
}

/** Validering af CMS-indholdet: advarsler vises, hvor de gælder, og som sum øverst. */
export function collectWarnings(questions: CmsQuestion[], tags: CmsTag[], advisors: CmsAdvisor[]): CmsWarning[] {
  const out: CmsWarning[] = [];
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const covered = new Set(advisors.flatMap((a) => a.tagIds));
  const flaggedTags = new Set<string>();

  for (const q of questions) {
    if (q.active && q.answers.length < 2) {
      out.push({ scope: "question", id: q.id, questionId: q.id, message: "Et aktivt spørgsmål skal have mindst 2 svar." });
    }
    for (const a of q.answers) {
      if (a.weights.length === 0 && a.boardSize === null) {
        out.push({ scope: "answer", id: a.id, questionId: q.id, message: "Svaret har ingen tag-vægte og påvirker ikke forslaget." });
      }
      for (const w of a.weights) {
        const tag = tagById.get(w.tagId);
        if (!tag || flaggedTags.has(w.tagId)) continue;
        if (!tag.active) {
          flaggedTags.add(w.tagId);
          out.push({ scope: "tag", id: tag.id, questionId: q.id, message: `Tagget «${tag.name}» er deaktiveret og ignoreres i matchingen.` });
        } else if (!covered.has(tag.id)) {
          flaggedTags.add(w.tagId);
          out.push({
            scope: "tag",
            id: tag.id,
            questionId: q.id,
            message: `Ingen aktive rådgivere har tagget «${tag.name}», så behovet kan aldrig dækkes.`,
          });
        }
      }
    }
  }
  return out;
}

/** Tags der bruges i svar, men ikke kan dækkes (til tag-siden). */
export function uncoverableTagIds(questions: CmsQuestion[], tags: CmsTag[], advisors: CmsAdvisor[]): Set<string> {
  return new Set(collectWarnings(questions, tags, advisors).filter((w) => w.scope === "tag").map((w) => w.id));
}
