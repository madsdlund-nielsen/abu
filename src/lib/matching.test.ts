import { describe, expect, it } from "vitest";
import { advisorScore, boardCoverage, computeNeeds, suggestBoard, type MatchAdvisor, type MatchAnswer } from "./matching";

const adv = (id: string, tagIds: string[], priceDkk = 1750, active = true): MatchAdvisor => ({ id, name: id, priceDkk, active, tagIds });
const ans = (w: Record<string, number>, boardSize?: number): MatchAnswer => ({
  tagWeights: Object.entries(w).map(([tagId, weight]) => ({ tagId, weight })),
  boardSize,
});

describe("computeNeeds / advisorScore", () => {
  it("lægger vægte sammen pr. tag over svar", () => {
    expect(computeNeeds([ans({ a: 5, b: 2 }), ans({ a: 3 })])).toEqual({ a: 8, b: 2 });
  });
  it("scorer rådgiveren som sum af behov for hans tags", () => {
    expect(advisorScore(["a", "c"], { a: 8, b: 2 })).toBe(8);
  });
});

describe("suggestBoard", () => {
  it("vælger komplementært i stedet for tre ens profiler", () => {
    const advisors = [adv("x1", ["a", "b"]), adv("x2", ["a", "b"]), adv("y", ["c"]), adv("z", ["d"])];
    const r = suggestBoard(advisors, [ans({ a: 5, b: 4, c: 3, d: 3 }, 3)]);
    // x1 (9) først. x2 har nu kun 0,3 × 9 = 2,7 værd, mens y (3) og z (3) slår den.
    expect(r.advisorIds).toEqual(["x1", "y", "z"]);
    expect(r.uncoveredTagIds).toEqual([]);
    expect(r.coverage).toBe(1);
  });

  it("bruger den største boardSize blandt svarene", () => {
    const advisors = [adv("a", ["t1"]), adv("b", ["t2"]), adv("c", ["t3"]), adv("d", ["t4"])];
    const r = suggestBoard(advisors, [ans({ t1: 5 }, 2), ans({ t2: 3 }, 4)]);
    expect(r.size).toBe(4);
    expect(r.sizeReason).toBe("boardSize");
  });

  it("stopper ved 80 % dækning (men mindst 2)", () => {
    const advisors = [adv("a", ["t1"]), adv("b", ["t2"]), adv("c", ["t3"]), adv("d", ["t4"])];
    // t1 = 10 dækker alene 91 % af 11, men der kræves mindst to
    const r = suggestBoard(advisors, [ans({ t1: 10, t2: 1 })]);
    expect(r.advisorIds).toEqual(["a", "b"]);
    expect(r.sizeReason).toBe("coverage");
    // spredte behov kræver flere: 4 × 5 giver 25 % pr. rådgiver, så 4 behøves for at nå 80 %+
    const r2 = suggestBoard(advisors, [ans({ t1: 5, t2: 5, t3: 5, t4: 5 })]);
    expect(r2.size).toBe(4);
  });

  it("er 3 som standard uden behov, og laveste pris vinder ved lige score", () => {
    const advisors = [adv("dyr", ["a"], 2500), adv("billig", ["b"], 1500), adv("mellem", ["c"], 1750), adv("fjerde", ["d"], 1750)];
    const r = suggestBoard(advisors, []);
    expect(r.size).toBe(3);
    expect(r.sizeReason).toBe("default");
    expect(r.advisorIds).toEqual(["billig", "fjerde", "mellem"]);
  });

  it("bryder lige pris alfabetisk", () => {
    const r = suggestBoard([adv("Bo", ["a"]), adv("Anna", ["a"])], [ans({ a: 5 }, 2)]);
    expect(r.advisorIds).toEqual(["Anna", "Bo"]);
  });

  it("ignorerer inaktive rådgivere og rådgivere uden tags", () => {
    const advisors = [adv("inaktiv", ["a"], 1750, false), adv("utagget", []), adv("ok1", ["a"]), adv("ok2", ["b"])];
    const r = suggestBoard(advisors, [ans({ a: 5, b: 1 })]);
    expect(r.advisorIds.sort()).toEqual(["ok1", "ok2"]);
    expect(r.scores.map((s) => s.advisorId)).not.toContain("inaktiv");
    expect(r.scores.map((s) => s.advisorId)).not.toContain("utagget");
  });

  it("returnerer det antal der findes, hvis der er for få rådgivere", () => {
    const r = suggestBoard([adv("a", ["x"])], [ans({ x: 3 }, 4)]);
    expect(r.advisorIds).toEqual(["a"]);
  });

  it("rapporterer udækkede behov og begrundelse", () => {
    const advisors = [adv("a", ["t1", "t2"]), adv("b", ["t2"])];
    const r = suggestBoard(advisors, [ans({ t1: 4, t2: 2, t3: 3 }, 2)]);
    expect(r.uncoveredTagIds).toEqual(["t3"]);
    expect(r.picks[0].matchedTagIds).toEqual(["t1", "t2"]);
    expect(r.picks[1].newTagIds).toEqual([]);
    expect(r.coverage).toBeCloseTo(6 / 9);
  });
});

describe("boardCoverage", () => {
  it("opdeler behov i dækkede og udækkede", () => {
    const c = boardCoverage({ a: 3, b: 1, c: 0 }, ["a"]);
    expect(c.covered).toEqual(["a"]);
    expect(c.uncovered).toEqual(["b"]);
    expect(c.coverage).toBe(0.75);
  });
});
