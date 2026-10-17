import { describe, expect, it } from "vitest";
import { describeDb } from "../test/db";
import { DEFAULT_PRICE_BOUNDS, validateAdvisorPrice, validatePriceBounds } from "./advisor-price";

describe("rådgiverpris (plan #20)", () => {
  it("skal ligge mellem 500 og 25.000 kr. som standard", () => {
    expect(DEFAULT_PRICE_BOUNDS).toEqual({ min: 500, max: 25000 });
    expect(validateAdvisorPrice(1750, DEFAULT_PRICE_BOUNDS)).toBeNull();
    expect(validateAdvisorPrice(500, DEFAULT_PRICE_BOUNDS)).toBeNull();
    expect(validateAdvisorPrice(25000, DEFAULT_PRICE_BOUNDS)).toBeNull();
    expect(validateAdvisorPrice(0, DEFAULT_PRICE_BOUNDS)).toMatch(/mellem 500 og 25\.000 kr/);
    expect(validateAdvisorPrice(5, DEFAULT_PRICE_BOUNDS)).not.toBeNull();
    expect(validateAdvisorPrice(25001, DEFAULT_PRICE_BOUNDS)).not.toBeNull();
    expect(validateAdvisorPrice(1750.5, DEFAULT_PRICE_BOUNDS)).toMatch(/helt antal/);
  });
  it("grænserne kan ændres, men skal give mening", () => {
    expect(validateAdvisorPrice(300, { min: 250, max: 1000 })).toBeNull();
    expect(validatePriceBounds({ min: 0, max: 100 })).not.toBeNull();
    expect(validatePriceBounds({ min: 1000, max: 1000 })).not.toBeNull();
    expect(validatePriceBounds({ min: 500, max: 200000 })).not.toBeNull();
    expect(validatePriceBounds({ min: 400, max: 30000 })).toBeNull();
  });
});

describeDb("prisgrænser i AppSetting (plan #20)", () => {
  it("gemmes og læses; ugyldige værdier falder tilbage til standard", async () => {
    const { prisma } = await import("./db");
    const { getPriceBounds, savePriceBounds } = await import("./advisor-price");
    await savePriceBounds({ min: 600, max: 20000 });
    expect(await getPriceBounds()).toEqual({ min: 600, max: 20000 });
    await prisma.appSetting.update({ where: { key: "advisor.priceMinDkk" }, data: { value: "99999" } });
    expect(await getPriceBounds()).toEqual(DEFAULT_PRICE_BOUNDS);
    await prisma.appSetting.deleteMany({ where: { key: { startsWith: "advisor.price" } } });
  });
});
