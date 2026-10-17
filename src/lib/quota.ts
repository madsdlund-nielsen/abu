import { addDaysKey, dayDiff, localDateKey, localToUtc } from "./time";

export const LATE_CANCEL_HOURS = 48;

/** Indeks (0-baseret) på den periode et tidspunkt falder i, set fra abonnementets start. */
export function periodIndexAt(startedAt: Date, at: Date, frequencyWeeks: number): number {
  const days = dayDiff(localDateKey(startedAt), localDateKey(at));
  return Math.floor(days / (frequencyWeeks * 7));
}

/** Periodens grænser: lokal midnat til lokal midnat (halvåben [start, end)). */
export function periodBounds(startedAt: Date, index: number, frequencyWeeks: number) {
  const startKey = addDaysKey(localDateKey(startedAt), index * frequencyWeeks * 7);
  const endKey = addDaysKey(startKey, frequencyWeeks * 7);
  return { start: localToUtc(startKey, 0), end: localToUtc(endKey, 0) };
}

export interface QuotaMeeting {
  startsAt: Date;
  status: "BOOKED" | "COMPLETED" | "CANCELLED";
  cancelledAt?: Date | null;
}

/** Aflysning ≥ 48 t før start frigiver kvoten. */
export function cancellationFreesQuota(startsAt: Date, cancelledAt: Date): boolean {
  return startsAt.getTime() - cancelledAt.getTime() >= LATE_CANCEL_HOURS * 3_600_000;
}

/** Tæller mødet mod kvoten? */
export function countsTowardsQuota(m: QuotaMeeting): boolean {
  if (m.status !== "CANCELLED") return true;
  if (!m.cancelledAt) return false;
  return !cancellationFreesQuota(m.startsAt, m.cancelledAt);
}

export interface QuotaState {
  currentPeriod: number;
  /** Perioder (aktuel og næste) hvor der stadig er en ledig kvote */
  openPeriods: number[];
}

export function quotaState(
  startedAt: Date,
  frequencyWeeks: number,
  meetings: QuotaMeeting[],
  now: Date,
): QuotaState {
  const current = Math.max(0, periodIndexAt(startedAt, now, frequencyWeeks));
  const used = new Set(
    meetings.filter(countsTowardsQuota).map((m) => periodIndexAt(startedAt, m.startsAt, frequencyWeeks)),
  );
  return {
    currentPeriod: current,
    openPeriods: [current, current + 1].filter((p) => !used.has(p)),
  };
}

/** Må der bookes et møde på dette starttidspunkt? */
export function canBookAt(
  startedAt: Date,
  frequencyWeeks: number,
  meetings: QuotaMeeting[],
  start: Date,
  now: Date,
): boolean {
  const idx = periodIndexAt(startedAt, start, frequencyWeeks);
  return quotaState(startedAt, frequencyWeeks, meetings, now).openPeriods.includes(idx);
}
