import { describe, expect, it } from "vitest";
import { blockedDates, danishHolidays, easterSunday } from "./holidays";
import { computeSlots } from "./slots";

const names = (y: number) => Object.fromEntries(danishHolidays(y).map((h) => [h.key, h.date]));

describe("danske helligdage (plan #24)", () => {
  it("beregner påskedag korrekt for mange år", () => {
    const known: Record<number, string> = {
      2000: "2000-04-23", 2008: "2008-03-23", 2011: "2011-04-24", 2019: "2019-04-21", 2023: "2023-04-09", 2024: "2024-03-31",
      2025: "2025-04-20", 2026: "2026-04-05", 2027: "2027-03-28", 2028: "2028-04-16", 2029: "2029-04-01", 2030: "2030-04-21",
      2038: "2038-04-25", 2285: "2285-03-22",
    };
    for (const [y, d] of Object.entries(known)) expect(easterSunday(Number(y)), y).toBe(d);
  });

  it("2026: alle påskeafhængige og faste helligdage", () => {
    expect(names(2026)).toMatchObject({
      nytaarsdag: "2026-01-01",
      skaertorsdag: "2026-04-02",
      langfredag: "2026-04-03",
      paaskedag: "2026-04-05",
      "2-paaskedag": "2026-04-06",
      "kristi-himmelfart": "2026-05-14",
      pinsedag: "2026-05-24",
      "2-pinsedag": "2026-05-25",
      juleaften: "2026-12-24",
      juledag: "2026-12-25",
      "2-juledag": "2026-12-26",
      nytaarsaften: "2026-12-31",
    });
  });

  it("2025 og 2027 (påske i april hhv. marts)", () => {
    expect(names(2025)).toMatchObject({ skaertorsdag: "2025-04-17", "kristi-himmelfart": "2025-05-29", "2-pinsedag": "2025-06-09" });
    expect(names(2027)).toMatchObject({ langfredag: "2027-03-26", "2-paaskedag": "2027-03-29", "kristi-himmelfart": "2027-05-06", pinsedag: "2027-05-16" });
  });

  it("Store bededag findes til og med 2023, ikke fra 2024", () => {
    expect(names(2023)["store-bededag"]).toBe("2023-05-05");
    expect(names(2024)["store-bededag"]).toBeUndefined();
    expect(names(2026)["store-bededag"]).toBeUndefined();
  });

  it("juleaften og nytårsaften er spærret som standard; grundlovsdag ikke; admin kan ændre", () => {
    const def = blockedDates([2026], {});
    expect(def.has("2026-12-24")).toBe(true);
    expect(def.has("2026-12-31")).toBe(true);
    expect(def.has("2026-06-05")).toBe(false);
    expect(def.has("2026-04-03")).toBe(true);
    const changed = blockedDates([2026], { "2026-12-24": false, "2026-06-05": true });
    expect(changed.has("2026-12-24")).toBe(false);
    expect(changed.has("2026-06-05")).toBe(true);
  });

  it("spærrede datoer giver ingen ledige tider", () => {
    const advisor = { id: "a", rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 16 * 60 })), blocks: [], meetings: [] };
    const now = new Date("2026-12-14T08:00:00Z");
    const slots = computeSlots([advisor], { now, durationMinutes: 120, maxWeeksAhead: 3, blockedDates: blockedDates([2026], {}) });
    const days = new Set(slots.map((s) => s.toISOString().slice(0, 10)));
    expect(days.has("2026-12-23")).toBe(true);
    expect(days.has("2026-12-24")).toBe(false);
    expect(days.has("2026-12-25")).toBe(false);
    expect(days.has("2026-12-31")).toBe(false);
    expect(days.has("2026-12-30")).toBe(true);
  });
});

import { asAnon, asSystem, asUser, describeDb } from "../test/db";

describeDb("overstyring af helligdage i AppSetting (plan #24)", () => {
  it("gemmer en ændring og fjerner den igen, når den svarer til standarden", async () => {
    const { prisma } = await import("./db");
    const { getHolidayOverrides, setHolidayBlocked, getBlockedDates } = await import("./holidays");
    const y = new Date().getFullYear() + 1;
    // Admin ændrer (Admin → Helligdage); bookingen læser spærringen som kunde (og før login er den heller ikke hemmelig)
    const admin = { id: "test-admin", role: "ADMIN" as const };
    await asUser(admin, () => setHolidayBlocked(`${y}-12-24`, false));
    expect((await asUser(admin, () => getHolidayOverrides()))[`${y}-12-24`]).toBe(false);
    const blocked = await asUser({ id: "test-kunde", role: "CUSTOMER" }, () => getBlockedDates(new Date(`${y}-12-20T12:00:00Z`), new Date(`${y}-12-31T12:00:00Z`)));
    expect(blocked.has(`${y}-12-24`)).toBe(false);
    expect(blocked.has(`${y}-12-25`)).toBe(true);
    expect((await asAnon(() => getHolidayOverrides()))[`${y}-12-24`]).toBe(false);
    // Kun admin må ændre (RLS: AppSetting skrives kun af admin/system)
    await expect(asUser({ id: "test-kunde", role: "CUSTOMER" }, () => setHolidayBlocked(`${y}-12-24`, true))).rejects.toThrow();
    await asUser(admin, () => setHolidayBlocked(`${y}-12-24`, true));
    expect(`${y}-12-24` in (await asUser(admin, () => getHolidayOverrides()))).toBe(false);
    await expect(asUser(admin, () => setHolidayBlocked(`${y}-03-03`, true))).rejects.toThrow(/helligdag/);
    await asSystem(() => prisma.appSetting.deleteMany({ where: { key: "holidays.overrides" } }));
  });
});
