import {
  addDaysKey,
  dayDiff,
  isoWeekday,
  localDateKey,
  localToUtc,
  minutesSinceLocalMidnight,
} from "./time";

export interface AvailabilityRuleInput {
  /** ISO-ugedag: man=1 … søn=7 (København-tid) */
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

export interface AdvisorAvailability {
  id: string;
  rules: AvailabilityRuleInput[];
  /** Blokerede perioder (ferie mv.) */
  blocks: Interval[];
  /** Andre BOOKED møder for rådgiveren */
  meetings: Interval[];
}

export interface SlotOptions {
  now: Date;
  durationMinutes: number;
  stepMinutes?: number;
  bufferMinutes?: number;
  minLeadDays?: number;
  maxWeeksAhead?: number;
}

export const DEFAULTS = {
  stepMinutes: 30,
  bufferMinutes: 30,
  minLeadDays: 2,
  maxWeeksAhead: 16,
} as const;

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Er [start, start+varighed) ledigt for alle rådgivere? (ren funktion, ingen vindues-tjek) */
export function isSlotFreeForAll(
  advisors: AdvisorAvailability[],
  start: Date,
  durationMinutes: number,
  bufferMinutes: number = DEFAULTS.bufferMinutes,
): boolean {
  if (advisors.length === 0) return false;
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const startMin = minutesSinceLocalMidnight(start);
  const endMin = startMin + durationMinutes;
  const weekday = isoWeekday(start);
  // Mødet må ikke krydse midnat (lokal tid) – reglerne er pr. dag.
  if (endMin > 1440) return false;

  const bufMs = bufferMinutes * 60_000;
  return advisors.every((a) => {
    const insideRule = a.rules.some(
      (r) => r.weekday === weekday && r.startMinute <= startMin && endMin <= r.endMinute,
    );
    if (!insideRule) return false;
    if (a.blocks.some((b) => overlaps(start, end, b.startsAt, b.endsAt))) return false;
    if (
      a.meetings.some((m) =>
        overlaps(
          start,
          end,
          new Date(m.startsAt.getTime() - bufMs),
          new Date(m.endsAt.getTime() + bufMs),
        ),
      )
    ) {
      return false;
    }
    return true;
  });
}

/** Vinduet for bookbare tidspunkter: [now + minLeadDays, now + maxWeeksAhead uger] */
export function bookingWindow(opts: Pick<SlotOptions, "now" | "minLeadDays" | "maxWeeksAhead">) {
  const lead = opts.minLeadDays ?? DEFAULTS.minLeadDays;
  const weeks = opts.maxWeeksAhead ?? DEFAULTS.maxWeeksAhead;
  return {
    earliest: new Date(opts.now.getTime() + lead * 86_400_000),
    latest: new Date(opts.now.getTime() + weeks * 7 * 86_400_000),
  };
}

/**
 * Beregner alle ledige starttidspunkter hvor ALLE rådgivere i boardet er ledige.
 * Ren funktion – al data kommer ind som argumenter.
 */
export function computeSlots(advisors: AdvisorAvailability[], opts: SlotOptions): Date[] {
  const step = opts.stepMinutes ?? DEFAULTS.stepMinutes;
  const buffer = opts.bufferMinutes ?? DEFAULTS.bufferMinutes;
  const { earliest, latest } = bookingWindow(opts);
  if (advisors.length === 0) return [];

  const firstKey = localDateKey(earliest);
  const lastKey = localDateKey(latest);
  const days = dayDiff(firstKey, lastKey);
  const result: Date[] = [];

  for (let i = 0; i <= days; i++) {
    const key = addDaysKey(firstKey, i);
    const weekday = isoWeekday(localToUtc(key, 12 * 60));
    // Hurtig afvisning: alle skal have mindst én regel denne ugedag
    if (!advisors.every((a) => a.rules.some((r) => r.weekday === weekday))) continue;
    for (let min = 0; min + opts.durationMinutes <= 1440; min += step) {
      const start = localToUtc(key, min);
      if (start < earliest || start > latest) continue;
      if (isSlotFreeForAll(advisors, start, opts.durationMinutes, buffer)) result.push(start);
    }
  }
  return result;
}
