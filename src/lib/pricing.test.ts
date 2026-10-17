import { describe, expect, it } from "vitest";
import { monthlyPriceDkk, monthlyPriceForBoard, planHandle, vatBreakdown } from "./pricing";

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
  it("bygger plan-handle pr. frekvens", () => {
    expect(planHandle(8)).toBe("abu-8w");
    expect(planHandle(4)).toBe("abu-4w");
    expect(() => planHandle(6)).toThrow();
  });
});

describe("monthlyPriceForBoard", () => {
  it("giver tabellens priser, når alle koster 1.750", () => {
    expect(monthlyPriceForBoard([1750, 1750, 1750], 8)).toBe(2844);
    expect(monthlyPriceForBoard([1750, 1750], 4)).toBe(3792);
    expect(monthlyPriceForBoard([1750, 1750, 1750, 1750], 4)).toBe(7583);
  });
  it("summerer individuelle mødepriser", () => {
    // (2250 + 1750 + 1500) × 52 / 8 / 12 = 2979,17
    expect(monthlyPriceForBoard([2250, 1750, 1500], 8)).toBe(2979);
    expect(monthlyPriceForBoard([2500, 2000], 12)).toBe(1625);
  });
  it("rækkefølgen er ligegyldig", () => {
    expect(monthlyPriceForBoard([1500, 2500, 1750], 12)).toBe(monthlyPriceForBoard([2500, 1750, 1500], 12));
  });
  it("afviser ugyldige boards", () => {
    expect(() => monthlyPriceForBoard([1750], 8)).toThrow();
    expect(() => monthlyPriceForBoard([1, 2, 3, 4, 5], 8)).toThrow();
    expect(() => monthlyPriceForBoard([1750, 1750], 6)).toThrow();
    expect(() => monthlyPriceForBoard([1750, -1], 8)).toThrow();
  });
});

describe("vatBreakdown", () => {
  it("lægger 25 % moms til", () => {
    expect(vatBreakdown(2844)).toEqual({ exVat: 2844, vat: 711, incVat: 3555 });
  });
});
