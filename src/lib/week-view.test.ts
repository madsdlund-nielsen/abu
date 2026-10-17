import { describe, expect, it } from "vitest";
import { buildWeek, clampWeek, firstWeekWithSlots, isoWeekNumber, mondayKey, weekLabel, weekPeriods } from "./week-view";
import { localToUtc } from "./time";

const at = (key: string, hhmm: number) => localToUtc(key, hhmm * 60);

describe("uge-hjælpere", () => {
  it("finder mandagen", () => {
    expect(mondayKey("2026-10-19")).toBe("2026-10-19");
    expect(mondayKey("2026-10-25")).toBe("2026-10-19");
    expect(mondayKey("2026-10-17")).toBe("2026-10-12");
    expect(mondayKey("2026-11-01")).toBe("2026-10-26");
  });
  it("beregner ISO-ugenummer", () => {
    expect(isoWeekNumber("2026-10-19")).toBe(43);
    expect(isoWeekNumber("2026-12-28")).toBe(53);
    expect(isoWeekNumber("2027-01-04")).toBe(1);
  });
  it("laver overskrift som 'Uge 43 · 19.–25. oktober'", () => {
    expect(weekLabel("2026-10-19")).toBe("Uge 43 · 19.–25. oktober");
    expect(weekLabel("2026-10-26")).toBe("Uge 44 · 26. oktober – 1. november");
    expect(weekLabel("2026-12-28")).toBe("Uge 53 · 28. december 2026 – 3. januar 2027");
  });
});

describe("buildWeek", () => {
  const slots = [at("2026-10-21", 9), at("2026-10-21", 13), at("2026-10-19", 10), at("2026-10-27", 9)];
  it("grupperer pr. dag og sorterer, kun man–fre uden weekendtider", () => {
    const w = buildWeek(slots, "2026-10-19");
    expect(w.days.map((d) => d.key)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(w.days[0].slots).toHaveLength(1);
    expect(w.days[2].slots).toHaveLength(2);
    expect(w.days[2].slots[0] < w.days[2].slots[1]).toBe(true);
    expect(w.total).toBe(3);
  });
  it("tager weekend med kun hvis der er tider", () => {
    const w = buildWeek([...slots, at("2026-10-24", 10)], "2026-10-19");
    expect(w.days).toHaveLength(7);
    expect(w.days[5].slots).toHaveLength(1);
  });
});

describe("firstWeekWithSlots", () => {
  it("starter i første uge med ledige tider", () => {
    expect(firstWeekWithSlots([at("2026-11-04", 9), at("2026-10-28", 9)])).toBe("2026-10-26");
    expect(firstWeekWithSlots([])).toBeNull();
  });
});

describe("weekPeriods", () => {
  // abonnement startet onsdag 7. oktober 2026, hver 4. uge: periode 0 = 7/10–3/11, periode 1 = 4/11–1/12
  const startedAt = new Date("2026-10-07T08:00:00Z");
  it("angiver perioden en uge hører til", () => {
    const [p] = weekPeriods("2026-10-12", startedAt, 4, 0, [0, 1]);
    expect(p).toMatchObject({ index: 0, startKey: "2026-10-07", endKey: "2026-11-03", kind: "current", open: true });
  });
  it("kan krydse en periodegrænse", () => {
    const ps = weekPeriods("2026-11-02", startedAt, 4, 0, [1]);
    expect(ps.map((p) => p.index)).toEqual([0, 1]);
    expect(ps[0].open).toBe(false);
    expect(ps[1]).toMatchObject({ kind: "next", open: true });
  });
});

describe("clampWeek", () => {
  it("holder ugen inden for grænserne", () => {
    expect(clampWeek("2026-09-01", "2026-10-12", "2027-01-25")).toBe("2026-10-12");
    expect(clampWeek("2028-01-03", "2026-10-12", "2027-01-25")).toBe("2027-01-25");
    expect(clampWeek("2026-11-02", "2026-10-12", "2027-01-25")).toBe("2026-11-02");
  });
});
