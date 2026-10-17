import { describe, expect, it } from "vitest";
import { monthlyPriceDkk, planHandle } from "./pricing";

describe("monthlyPriceDkk", () => {
  const table: Record<number, [number, number, number]> = {
    4: [3792, 5688, 7583],
    8: [1896, 2844, 3792],
    12: [1264, 1896, 2528],
  };
  for (const [weeks, prices] of Object.entries(table)) {
    [2, 3, 4].forEach((advisors, i) => {
      it(`${advisors} rådgivere hver ${weeks}. uge = ${prices[i]} kr.`, () => {
        expect(monthlyPriceDkk(advisors, Number(weeks))).toBe(prices[i]);
      });
    });
  }
  it("afviser ugyldige værdier", () => {
    expect(() => monthlyPriceDkk(5, 4)).toThrow();
    expect(() => monthlyPriceDkk(2, 6)).toThrow();
  });
  it("bygger plan-handle", () => {
    expect(planHandle(3, 8)).toBe("abu-3a-8w");
  });
});
