import { describe, expect, it } from "vitest";
import { computeSlots, isSlotFreeForAll, type AdvisorAvailability } from "./slots";
import { formatInTimeZone } from "date-fns-tz";

// Mandag 5. januar 2026, 09:00 dansk tid (vinter, UTC+1)
const NOW = new Date("2026-01-05T08:00:00Z");
const local = (d: Date) => formatInTimeZone(d, "Europe/Copenhagen", "yyyy-MM-dd HH:mm");

function advisor(over: Partial<AdvisorAvailability> = {}): AdvisorAvailability {
  return {
    id: "a1",
    // man-fre 09:00-16:00
    rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 16 * 60 })),
    blocks: [],
    meetings: [],
    ...over,
  };
}

const opts = { now: NOW, durationMinutes: 120 };

describe("computeSlots", () => {
  it("giver ingen slots uden rådgivere", () => {
    expect(computeSlots([], opts)).toEqual([]);
  });

  it("respekterer minimum 2 dages varsel", () => {
    const slots = computeSlots([advisor()], opts);
    expect(local(slots[0])).toBe("2026-01-07 09:00"); // onsdag, tidligst 07/01 09:00
    expect(slots.every((s) => s >= new Date("2026-01-07T08:00:00Z"))).toBe(true);
  });

  it("respekterer maks 16 uger frem", () => {
    const slots = computeSlots([advisor()], opts);
    const limit = new Date(NOW.getTime() + 16 * 7 * 86_400_000);
    expect(slots.every((s) => s <= limit)).toBe(true);
    expect(slots.some((s) => s > new Date(NOW.getTime() + 15 * 7 * 86_400_000))).toBe(true);
  });

  it("kræver at mødet ligger helt inde i reglen (09-16, 2 timer => sidste start 14:00)", () => {
    const slots = computeSlots([advisor()], opts).filter((s) => local(s).startsWith("2026-01-07"));
    expect(slots.map((s) => local(s).slice(11))).toEqual([
      "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00",
    ]);
  });

  it("udelader weekender", () => {
    const slots = computeSlots([advisor()], opts);
    expect(slots.some((s) => ["Sat", "Sun"].includes(formatInTimeZone(s, "Europe/Copenhagen", "EEE")))).toBe(false);
  });

  it("udelader blokerede perioder", () => {
    const blocks = [{ startsAt: new Date("2026-01-07T09:00:00Z"), endsAt: new Date("2026-01-07T23:00:00Z") }];
    const slots = computeSlots([advisor({ blocks })], opts).filter((s) => local(s).startsWith("2026-01-07"));
    // Blokering starter 10:00 lokal -> kun start 09:00 slutter 11:00 overlapper => ingen slots tilbage før 10:00
    expect(slots).toEqual([]);
  });

  it("holder 30 min buffer til andre møder", () => {
    const meetings = [{ startsAt: new Date("2026-01-07T10:00:00Z"), endsAt: new Date("2026-01-07T12:00:00Z") }]; // 11-13 lokal
    const slots = computeSlots([advisor({ meetings })], opts)
      .filter((s) => local(s).startsWith("2026-01-07"))
      .map((s) => local(s).slice(11));
    // Møde 11:00-13:00 + buffer => forbudt interval 10:30-13:30. Start t.o.m. 08:30 (ikke muligt) ; start >= 13:30
    expect(slots).toEqual(["13:30", "14:00"]);
  });

  it("kræver at ALLE rådgivere er ledige", () => {
    const a = advisor({ id: "a" });
    const b = advisor({
      id: "b",
      rules: [{ weekday: 3, startMinute: 13 * 60, endMinute: 17 * 60 }],
    });
    const slots = computeSlots([a, b], opts).filter((s) => local(s).startsWith("2026-01-07")).map((s) => local(s).slice(11));
    expect(slots).toEqual(["13:00", "13:30", "14:00"]);
  });

  it("håndterer sommertid (UTC+2) korrekt", () => {
    const summer = computeSlots([advisor()], { now: new Date("2026-06-01T06:00:00Z"), durationMinutes: 120 });
    expect(local(summer[0])).toBe("2026-06-03 09:00");
    expect(summer[0].toISOString()).toBe("2026-06-03T07:00:00.000Z");
  });

  it("støtter anden varighed", () => {
    const slots = computeSlots([advisor()], { now: NOW, durationMinutes: 60 }).filter((s) => local(s).startsWith("2026-01-07"));
    expect(slots.length).toBe(13); // 09:00..15:00 hver 30. min
  });
});

describe("isSlotFreeForAll", () => {
  it("afviser slots der krydser midnat", () => {
    const a = advisor({ rules: [{ weekday: 3, startMinute: 0, endMinute: 1440 }] });
    expect(isSlotFreeForAll([a], new Date("2026-01-07T22:30:00Z"), 120)).toBe(false);
  });
  it("accepterer et ledigt slot og afviser et optaget", () => {
    const m = [{ startsAt: new Date("2026-01-07T08:00:00Z"), endsAt: new Date("2026-01-07T10:00:00Z") }];
    const a = advisor({ meetings: m });
    expect(isSlotFreeForAll([a], new Date("2026-01-07T09:00:00Z"), 120)).toBe(false);
    expect(isSlotFreeForAll([advisor()], new Date("2026-01-07T09:00:00Z"), 120)).toBe(true);
  });
});
