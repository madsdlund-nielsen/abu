import { describe, expect, it } from "vitest";
import { canBookAt, cancellationFreesQuota, countsTowardsQuota, periodBounds, periodIndexAt, quotaState } from "./quota";

const START = new Date("2026-01-05T09:00:00Z"); // mandag
const d = (s: string) => new Date(s);

describe("periodIndexAt", () => {
  it("tæller perioder af N uger fra startdatoen", () => {
    expect(periodIndexAt(START, d("2026-01-05T09:00:00Z"), 8)).toBe(0);
    expect(periodIndexAt(START, d("2026-03-01T12:00:00Z"), 8)).toBe(0); // dag 55
    expect(periodIndexAt(START, d("2026-03-02T12:00:00Z"), 8)).toBe(1); // dag 56
    expect(periodIndexAt(START, d("2026-01-30T12:00:00Z"), 4)).toBe(0);
    expect(periodIndexAt(START, d("2026-02-02T12:00:00Z"), 4)).toBe(1);
  });
  it("er stabil over sommertidsskift", () => {
    // 12 uger = 84 dage -> 30/3 er DST-skift i 2026; periode 1 begynder 2026-03-30 lokal midnat
    expect(periodIndexAt(START, d("2026-03-29T21:00:00Z"), 12)).toBe(0); // 29/3 23:00 lokal => dag 83
    expect(periodIndexAt(START, d("2026-03-30T22:30:00Z"), 12)).toBe(1);
  });
  it("giver negativ indeks før start", () => {
    expect(periodIndexAt(START, d("2026-01-01T12:00:00Z"), 4)).toBe(-1);
  });
});

describe("periodBounds", () => {
  it("returnerer sammenhængende perioder", () => {
    const p0 = periodBounds(START, 0, 4);
    const p1 = periodBounds(START, 1, 4);
    expect(p0.end.getTime()).toBe(p1.start.getTime());
    expect(p0.start.toISOString()).toBe("2026-01-04T23:00:00.000Z");
  });
});

describe("annullering", () => {
  const starts = d("2026-02-10T10:00:00Z");
  it("≥ 48 t før frigiver kvoten", () => {
    expect(cancellationFreesQuota(starts, d("2026-02-08T10:00:00Z"))).toBe(true);
    expect(cancellationFreesQuota(starts, d("2026-02-08T10:00:01Z"))).toBe(false);
  });
  it("sen aflysning tæller som brugt", () => {
    expect(countsTowardsQuota({ startsAt: starts, status: "CANCELLED", cancelledAt: d("2026-02-09T10:00:00Z") })).toBe(true);
    expect(countsTowardsQuota({ startsAt: starts, status: "CANCELLED", cancelledAt: d("2026-02-01T10:00:00Z") })).toBe(false);
    expect(countsTowardsQuota({ startsAt: starts, status: "BOOKED" })).toBe(true);
    expect(countsTowardsQuota({ startsAt: starts, status: "COMPLETED" })).toBe(true);
  });
});

describe("quotaState / canBookAt", () => {
  const now = d("2026-01-20T10:00:00Z"); // periode 0 (4 uger)
  it("tillader aktuel og næste periode når intet er booket", () => {
    expect(quotaState(START, 4, [], now)).toEqual({ currentPeriod: 0, openPeriods: [0, 1] });
  });
  it("maks ét møde pr. periode", () => {
    const m = [{ startsAt: d("2026-01-22T10:00:00Z"), status: "BOOKED" as const }];
    expect(quotaState(START, 4, m, now).openPeriods).toEqual([1]);
    expect(canBookAt(START, 4, m, d("2026-01-27T10:00:00Z"), now)).toBe(false); // periode 0 optaget
    expect(canBookAt(START, 4, m, d("2026-02-03T10:00:00Z"), now)).toBe(true); // periode 1
  });
  it("kan ikke booke to perioder frem", () => {
    expect(canBookAt(START, 4, [], d("2026-03-05T10:00:00Z"), now)).toBe(false); // periode 2
  });
  it("tidlig aflysning frigiver, sen aflysning gør ikke", () => {
    const early = [{ startsAt: d("2026-01-30T10:00:00Z"), status: "CANCELLED" as const, cancelledAt: d("2026-01-20T10:00:00Z") }];
    const late = [{ startsAt: d("2026-01-30T10:00:00Z"), status: "CANCELLED" as const, cancelledAt: d("2026-01-29T10:00:00Z") }];
    expect(quotaState(START, 4, early, now).openPeriods).toEqual([0, 1]);
    expect(quotaState(START, 4, late, now).openPeriods).toEqual([1]);
  });
  it("fremrykker aktuel periode over tid", () => {
    expect(quotaState(START, 4, [], d("2026-02-10T10:00:00Z"))).toEqual({ currentPeriod: 1, openPeriods: [1, 2] });
  });
});
