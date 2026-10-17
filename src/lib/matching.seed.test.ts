import { describe, expect, it } from "vitest";
import { ADVISORS, QUESTIONS, TAGS } from "../../prisma/seed-data";
import { suggestBoard, type MatchAdvisor, type MatchAnswer } from "./matching";

/** Worked example på seed-data: den samme kunde som i dokumentationen (README). */
const advisors: MatchAdvisor[] = ADVISORS.map((a) => ({ id: a.name, name: a.name, priceDkk: a.price, active: true, tagIds: a.tags }));

function pick(questionIdx: number, ...answerIdx: number[]): MatchAnswer[] {
  const q = QUESTIONS[questionIdx];
  return answerIdx.map((i) => ({
    boardSize: q.answers[i].boardSize,
    tagWeights: Object.entries(q.answers[i].weights).map(([tagId, weight]) => ({ tagId, weight })),
  }));
}

describe("seed-data: matching", () => {
  it("alle tags i seed bruges af mindst én rådgiver", () => {
    const used = new Set(ADVISORS.flatMap((a) => a.tags));
    for (const t of TAGS) expect(used.has(t.slug)).toBe(true);
  });

  it("worked example: vækstvirksomhed på vej mod nye markeder", () => {
    const answers = [
      ...pick(0, 0), // vækst hurtigere
      ...pick(1, 1), // skalering
      ...pick(2, 1), // nye markeder
      ...pick(3, 1, 3), // mangler salg/marketing + teknologi
      ...pick(4, 1), // 10-49
    ];
    const r = suggestBoard(advisors, answers);
    // Behov: vækst & salg 13, marketing 7, digitalisering 6, ledelse 5, internationalisering 5, strategi 2, HR 2, økonomistyring 1 (i alt 41)
    expect(r.totalNeed).toBe(41);
    expect(r.needs["vaekst-salg"]).toBe(13);
    // 1) Louise scorer 26 (vækst 13 + marketing 7 + digitalisering 6).
    // 2) Jesper har basescore 18, men vækst & salg er nu dækket (13 -> 3,9), så effektiv score er 3,9 + 5 = 8,9 og slår stadig Søren (7).
    // 3) Efter to rådgivere er dækningen 31/41 = 76 % (< 80 %), så en tredje tilføjes: Søren (ledelse 5 + HR 2 = 7) slår Camilla (digitalisering nedskrevet).
    expect(r.advisorIds).toEqual(["Louise Kjær Hansen", "Jesper Holm Andersen", "Søren Bjerregaard"]);
    expect(r.picks.map((p) => p.effectiveScore)).toEqual([26, 8.9, 7]);
    expect(r.size).toBe(3);
    expect(r.sizeReason).toBe("coverage");
    expect(r.uncoveredTagIds.sort()).toEqual(["oekonomistyring", "strategi"]);
    expect(r.coverage).toBeCloseTo(38 / 41);
    expect(r.advisorIds.length).toBeGreaterThanOrEqual(2);
  });

  it("board-størrelsen følger svaret på sidste spørgsmål", () => {
    const r = suggestBoard(advisors, [...pick(0, 0), ...pick(5, 2)]);
    expect(r.size).toBe(4);
  });
});
