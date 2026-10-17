import type { MatchResult } from "../matching";
import type { QuestionWithAnswers } from "./catalog";
import type { SessionAnswers } from "./session";

export interface TestSnapshot {
  takenAt: string;
  answers: {
    questionId: string;
    question: string;
    type: "SINGLE" | "MULTI";
    answers: { answerId: string; text: string; boardSize: number | null; weights: { tagId: string; tag: string; weight: number }[] }[];
  }[];
  needs: { tagId: string; tag: string; weight: number }[];
  suggestedAdvisorIds: string[];
  suggestionSize: number;
  chosenAdvisorIds: string[];
}

/** Gemmer spørgsmåls- og svartekster, så historikken bevares, selv om CMS-indholdet ændres. */
export function buildTestSnapshot(
  questions: QuestionWithAnswers[],
  selected: SessionAnswers,
  tagNames: Map<string, string>,
  suggestion: Pick<MatchResult, "needs" | "advisorIds" | "size"> | null,
  chosenAdvisorIds: string[],
): TestSnapshot {
  const answers = questions
    .filter((q) => (selected[q.id] ?? []).length > 0)
    .map((q) => ({
      questionId: q.id,
      question: q.text,
      type: q.type,
      answers: q.answers
        .filter((a) => (selected[q.id] ?? []).includes(a.id))
        .map((a) => ({
          answerId: a.id,
          text: a.text,
          boardSize: a.boardSize,
          weights: a.weights.map((w) => ({ tagId: w.tagId, tag: tagNames.get(w.tagId) ?? w.tagId, weight: w.weight })),
        })),
    }));
  return {
    takenAt: new Date().toISOString(),
    answers,
    needs: Object.entries(suggestion?.needs ?? {})
      .map(([tagId, weight]) => ({ tagId, tag: tagNames.get(tagId) ?? tagId, weight }))
      .sort((a, b) => b.weight - a.weight),
    suggestedAdvisorIds: suggestion?.advisorIds ?? [],
    suggestionSize: suggestion?.size ?? 0,
    chosenAdvisorIds,
  };
}
