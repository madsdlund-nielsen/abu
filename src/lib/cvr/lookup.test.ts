import { afterEach, describe, expect, it, vi } from "vitest";
import { describeDb } from "../../test/db";
import { budgetKey, cacheTtlMs } from "./index";

describe("CVR-opslag: cache og dagsbudget (M-4)", () => {
  it("cacher også 'ikke fundet', men aldrig fejl", () => {
    expect(cacheTtlMs({ kind: "not_found" })).toBe(6 * 3_600_000);
    expect(cacheTtlMs({ kind: "error", message: "x" })).toBeNull();
    expect(cacheTtlMs({ kind: "error", message: "kvote", quota: true })).toBeNull();
  });
  it("dagsbudgettet følger dansk dato", () => {
    expect(budgetKey(new Date("2026-10-17T21:30:00Z"))).toBe("cvr-budget:2026-10-17");
    expect(budgetKey(new Date("2026-10-17T22:30:00Z"))).toBe("cvr-budget:2026-10-18"); // efter midnat i København
  });
});

describeDb("CVR-opslag mod databasen (M-4)", () => {
  afterEach(async () => (await import("./index")).setCvrProvider(null));

  it("cacher 'ikke fundet' delt i databasen og stopper ved dagsbudgettet", async () => {
    const { prisma } = await import("../db");
    const { lookupCvr, setCvrProvider } = await import("./index");
    const { storeKey } = await import("../rate-limit");
    const lookup = vi.fn().mockResolvedValue({ kind: "not_found" });
    setCvrProvider({ name: "cvrapi", lookup });
    // Unikt "døgn", så testen ikke deler budget med andre kørsler
    const day = new Date(Date.UTC(2100 + Math.floor(Math.random() * 500), 0, 1, 12));
    const cvr = "35000100";
    await prisma.cvrLookupCache.deleteMany({ where: { cvr } });
    expect(await lookupCvr(cvr, day)).toEqual({ kind: "not_found" });
    expect(await lookupCvr(cvr, day)).toEqual({ kind: "not_found" });
    expect(lookup).toHaveBeenCalledTimes(1); // andet opslag kom fra cachen

    // Budget brugt: nye numre slås ikke op eksternt, kunden får "kvote opbrugt" (manuel indtastning)
    await prisma.rateLimit.upsert({ where: { key: storeKey(budgetKey(day)) }, update: { count: 100000 }, create: { key: storeKey(budgetKey(day)), count: 100000, resetAt: new Date(day.getTime() + 86_400_000) } });
    await prisma.cvrLookupCache.deleteMany({ where: { cvr: "10150817" } });
    expect(await lookupCvr("10150817", day)).toMatchObject({ kind: "error", quota: true });
    expect(lookup).toHaveBeenCalledTimes(1);
    await prisma.cvrLookupCache.deleteMany({ where: { cvr } });
    await prisma.rateLimit.deleteMany({ where: { key: storeKey(budgetKey(day)) } });
  });
});
