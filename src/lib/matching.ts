/**
 * Matching af kundens behov (onboarding-testen) med rådgivere. Ren funktion uden I/O.
 *
 * 1. Behov: sum af tag-vægte (1-5) pr. tag over alle valgte svar.
 * 2. Rådgiverens score: sum af behovet for de tags, rådgiveren har.
 * 3. Boardet vælges grådigt for komplementaritet: højeste score først; derefter nedskrives behov, som boardet allerede
 *    dækker, til 30 % for de næste valg. Lige score: laveste pris, derefter alfabetisk.
 * 4. Størrelse: største `boardSize` blandt svarene; ellers tilføjes rådgivere, til boardet dækker mindst 80 % af den
 *    samlede behovsvægt (2-4, standard 3 når der ingen behov er).
 */

export interface MatchAnswer {
  tagWeights: { tagId: string; weight: number }[];
  boardSize?: number | null;
}

export interface MatchAdvisor {
  id: string;
  name: string;
  priceDkk: number;
  active: boolean;
  tagIds: string[];
}

export interface MatchPick {
  advisorId: string;
  /** Scoren på valgtidspunktet (efter nedskrivning af allerede dækkede tags) */
  effectiveScore: number;
  /** Scoren uden nedskrivning */
  baseScore: number;
  /** Tags rådgiveren har, som kunden har behov for, største behov først */
  matchedTagIds: string[];
  /** Heraf tags, der ikke var dækket af tidligere valg */
  newTagIds: string[];
}

export interface MatchResult {
  advisorIds: string[];
  size: number;
  sizeReason: "boardSize" | "coverage" | "default";
  needs: Record<string, number>;
  totalNeed: number;
  picks: MatchPick[];
  /** Basescore for alle kvalificerede rådgivere, højest først (til katalog og debug) */
  scores: { advisorId: string; score: number }[];
  coveredTagIds: string[];
  uncoveredTagIds: string[];
  /** 0-1: andel af den samlede behovsvægt boardet dækker */
  coverage: number;
}

export const REDUCED_WEIGHT = 0.3;
export const COVERAGE_TARGET = 0.8;
export const DEFAULT_SIZE = 3;
export const MIN_SIZE = 2;
export const MAX_SIZE = 4;

export function computeNeeds(answers: readonly MatchAnswer[]): Record<string, number> {
  const needs: Record<string, number> = {};
  for (const a of answers) for (const w of a.tagWeights) needs[w.tagId] = (needs[w.tagId] ?? 0) + w.weight;
  return needs;
}

export function advisorScore(tagIds: readonly string[], needs: Record<string, number>): number {
  let s = 0;
  for (const t of tagIds) s += needs[t] ?? 0;
  return s;
}

/** Hvilke af kundens behov dækkes af et board, og hvilke er udækkede? */
export function boardCoverage(needs: Record<string, number>, boardTagIds: readonly string[]) {
  const have = new Set(boardTagIds);
  const needed = Object.keys(needs).filter((t) => needs[t] > 0);
  const covered = needed.filter((t) => have.has(t));
  const uncovered = needed.filter((t) => !have.has(t));
  const total = needed.reduce((a, t) => a + needs[t], 0);
  const coveredWeight = covered.reduce((a, t) => a + needs[t], 0);
  return { covered, uncovered, coverage: total === 0 ? 1 : coveredWeight / total };
}

function byTieBreak(a: MatchAdvisor, b: MatchAdvisor) {
  return a.priceDkk - b.priceDkk || a.name.localeCompare(b.name, "da") || a.id.localeCompare(b.id);
}

export function sizeFromAnswers(answers: readonly MatchAnswer[]): number | null {
  const sizes = answers.map((a) => a.boardSize).filter((n): n is number => typeof n === "number" && n >= MIN_SIZE && n <= MAX_SIZE);
  return sizes.length ? Math.max(...sizes) : null;
}

export function suggestBoard(advisorsIn: readonly MatchAdvisor[], answers: readonly MatchAnswer[]): MatchResult {
  const advisors = advisorsIn.filter((a) => a.active && a.tagIds.length > 0);
  const needs = computeNeeds(answers);
  const totalNeed = Object.values(needs).reduce((a, b) => a + b, 0);
  const fixedSize = sizeFromAnswers(answers);
  const scores = advisors
    .map((a) => ({ a, score: advisorScore(a.tagIds, needs) }))
    .sort((x, y) => y.score - x.score || byTieBreak(x.a, y.a))
    .map(({ a, score }) => ({ advisorId: a.id, score }));

  const maxPicks = Math.min(fixedSize ?? MAX_SIZE, advisors.length);
  const working: Record<string, number> = { ...needs };
  const covered = new Set<string>();
  const picks: MatchPick[] = [];
  const remaining = [...advisors];

  const sizeReason: MatchResult["sizeReason"] = fixedSize ? "boardSize" : totalNeed === 0 ? "default" : "coverage";
  const target = fixedSize ?? (totalNeed === 0 ? Math.min(DEFAULT_SIZE, advisors.length) : null);

  while (remaining.length > 0 && picks.length < maxPicks) {
    if (target !== null && picks.length >= target) break;
    if (target === null && picks.length >= MIN_SIZE) {
      const coveredWeight = [...covered].reduce((a, t) => a + (needs[t] ?? 0), 0);
      if (coveredWeight / totalNeed >= COVERAGE_TARGET) break;
    }
    let best: MatchAdvisor | null = null;
    let bestScore = -1;
    for (const a of remaining) {
      const s = advisorScore(a.tagIds, working);
      if (s > bestScore || (s === bestScore && best && byTieBreak(a, best) < 0)) {
        best = a;
        bestScore = s;
      }
    }
    if (!best) break;
    const matched = best.tagIds.filter((t) => (needs[t] ?? 0) > 0).sort((x, y) => needs[y] - needs[x] || x.localeCompare(y));
    picks.push({
      advisorId: best.id,
      effectiveScore: round2(bestScore),
      baseScore: advisorScore(best.tagIds, needs),
      matchedTagIds: matched,
      newTagIds: matched.filter((t) => !covered.has(t)),
    });
    for (const t of best.tagIds) {
      covered.add(t);
      if (needs[t] !== undefined) working[t] = needs[t] * REDUCED_WEIGHT;
    }
    remaining.splice(remaining.indexOf(best), 1);
  }

  const boardTags = advisors.filter((a) => picks.some((p) => p.advisorId === a.id)).flatMap((a) => a.tagIds);
  const cov = boardCoverage(needs, boardTags);
  return {
    advisorIds: picks.map((p) => p.advisorId),
    size: picks.length,
    sizeReason,
    needs,
    totalNeed,
    picks,
    scores,
    coveredTagIds: cov.covered,
    uncoveredTagIds: cov.uncovered,
    coverage: cov.coverage,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
