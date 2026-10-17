import { describe, expect, it } from "vitest";
import { rankSubstituteCandidates, type SubstituteCandidate } from "./substitutes";
import { explainSlotConflict, type AdvisorAvailability } from "./slots";

const c = (id: string, over: Partial<SubstituteCandidate> = {}): SubstituteCandidate => ({
  id,
  name: id,
  title: "",
  priceDkk: 1750,
  tagIds: [],
  available: true,
  ...over,
});

describe("rankSubstituteCandidates", () => {
  const needs = { salg: 5, it: 3, hr: 1 };
  it("sætter ledige før optagede, uanset match", () => {
    const r = rankSubstituteCandidates([c("optaget", { available: false, tagIds: ["salg"] }), c("ledig", { tagIds: [] })], needs);
    expect(r.map((x) => x.id)).toEqual(["ledig", "optaget"]);
  });
  it("sorterer ledige efter tag-match (højeste først)", () => {
    const r = rankSubstituteCandidates([c("a", { tagIds: ["hr"] }), c("b", { tagIds: ["salg", "it"] }), c("d", { tagIds: ["it"] })], needs);
    expect(r.map((x) => [x.id, x.score])).toEqual([["b", 8], ["d", 3], ["a", 1]]);
  });
  it("sorterer lige match efter pris (laveste først), så navn", () => {
    const r = rankSubstituteCandidates(
      [c("dyr", { tagIds: ["it"], priceDkk: 2250 }), c("billig", { tagIds: ["it"], priceDkk: 1500 }), c("anden", { tagIds: ["it"], priceDkk: 1500, name: "Anden" })],
      needs,
    );
    expect(r.map((x) => x.id)).toEqual(["anden", "billig", "dyr"]);
  });
  it("angiver matchede tags, største behov først, og håndterer ingen behov", () => {
    const r = rankSubstituteCandidates([c("a", { tagIds: ["hr", "salg", "xx"] })], needs);
    expect(r[0].matchedTagIds).toEqual(["salg", "hr"]);
    expect(rankSubstituteCandidates([c("a", { tagIds: ["salg"] })], {})[0].score).toBe(0);
  });
  it("rører ikke ved input", () => {
    const input = [c("b"), c("a")];
    rankSubstituteCandidates(input, needs);
    expect(input.map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("explainSlotConflict", () => {
  // Torsdag 12. november 2026, 10:00-12:00 København (CET)
  const start = new Date("2026-11-12T09:00:00Z");
  const base: AdvisorAvailability = { id: "x", rules: [{ weekday: 4, startMinute: 9 * 60, endMinute: 16 * 60 }], blocks: [], meetings: [] };
  it("er ledig inden for reglen", () => expect(explainSlotConflict(base, start, 120)).toBeNull());
  it("forklarer manglende tilgængelighed, fravær og andet møde (med buffer)", () => {
    expect(explainSlotConflict({ ...base, rules: [] }, start, 120)).toBe("Udenfor tilgængelighed");
    expect(explainSlotConflict({ ...base, blocks: [{ startsAt: new Date("2026-11-12T08:00:00Z"), endsAt: new Date("2026-11-12T10:00:00Z") }] }, start, 120)).toBe("Har fravær");
    const other = { startsAt: new Date("2026-11-12T11:15:00Z"), endsAt: new Date("2026-11-12T13:15:00Z") }; // starter 15 min efter slut: inden for 30 min buffer
    expect(explainSlotConflict({ ...base, meetings: [other] }, start, 120)).toBe("Har et andet møde");
  });
});
