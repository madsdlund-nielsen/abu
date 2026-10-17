import { advisorScore } from "./matching";

export interface SubstituteCandidate {
  id: string;
  name: string;
  title: string;
  priceDkk: number;
  tagIds: string[];
  /** Ledig på mødets tidspunkt (samme regler som booking) */
  available: boolean;
  /** Hvorfor rådgiveren ikke er ledig */
  conflict?: string | null;
  /** Ikke aktiveret af admin: vises, men kan ikke vælges (QA #13) */
  inactive?: boolean;
}

export interface RankedCandidate extends SubstituteCandidate {
  /** Samlet behov for rådgiverens tags ud fra kundens testsvar */
  score: number;
  /** Tags, der matcher kundens behov, største behov først */
  matchedTagIds: string[];
}

/**
 * Kandidater til at overtage en plads i et møde. Sorteret efter (a) ledig på tidspunktet, (b) tag-match med kundens behov
 * (højest først), (c) pris (lavest først), derefter navn.
 */
export function rankSubstituteCandidates(candidates: SubstituteCandidate[], needs: Record<string, number>): RankedCandidate[] {
  return candidates
    .map((c) => ({
      ...c,
      score: advisorScore(c.tagIds, needs),
      matchedTagIds: c.tagIds.filter((t) => (needs[t] ?? 0) > 0).sort((a, b) => needs[b] - needs[a] || a.localeCompare(b)),
    }))
    .sort(
      (a, b) =>
        Number(Boolean(a.inactive)) - Number(Boolean(b.inactive)) ||
        Number(b.available) - Number(a.available) ||
        b.score - a.score ||
        a.priceDkk - b.priceDkk ||
        a.name.localeCompare(b.name, "da"),
    );
}
