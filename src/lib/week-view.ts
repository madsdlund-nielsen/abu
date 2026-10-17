import { getISOWeek } from "date-fns";
import { addDaysKey, localDateKey } from "./time";
import { periodBounds, periodIndexAt } from "./quota";

const MONTHS = [
  "januar", "februar", "marts", "april", "maj", "juni",
  "juli", "august", "september", "oktober", "november", "december",
];
const MONTHS_SHORT = ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
export const DAY_SHORT = ["man", "tir", "ons", "tor", "fre", "lør", "søn"];
export const DAY_LONG = ["mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"];

const parseKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return { y, m, d };
};
const utcNoon = (k: string) => {
  const { y, m, d } = parseKey(k);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

/** Mandagen i den ISO-uge, som datoen (yyyy-MM-dd) ligger i. */
export function mondayKey(dateKey: string): string {
  const wd = (utcNoon(dateKey).getUTCDay() + 6) % 7; // man=0
  return addDaysKey(dateKey, -wd);
}

export function isoWeekNumber(dateKey: string): number {
  return getISOWeek(utcNoon(dateKey));
}

export function isValidDateKey(k: string | undefined): k is string {
  if (!k || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
  const { y, m, d } = parseKey(k);
  const dt = utcNoon(k);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "Uge 43 · 19.–25. oktober" (over månedsskifte: "Uge 44 · 26. oktober – 1. november"). */
export function weekLabel(monday: string): string {
  const a = parseKey(monday);
  const b = parseKey(addDaysKey(monday, 6));
  const week = `Uge ${isoWeekNumber(monday)}`;
  let range: string;
  if (a.y !== b.y) range = `${a.d}. ${MONTHS[a.m - 1]} ${a.y} – ${b.d}. ${MONTHS[b.m - 1]} ${b.y}`;
  else if (a.m !== b.m) range = `${a.d}. ${MONTHS[a.m - 1]} – ${b.d}. ${MONTHS[b.m - 1]}`;
  else range = `${a.d}.–${b.d}. ${MONTHS[a.m - 1]}`;
  return `${week} · ${range}`;
}

/** Kort dato til noter: "12. okt." */
export function shortDate(dateKey: string): string {
  const { m, d } = parseKey(dateKey);
  return `${d}. ${MONTHS_SHORT[m - 1]}`;
}

export interface WeekDay {
  key: string;
  /** 0 = mandag … 6 = søndag */
  index: number;
  slots: Date[];
}

export interface WeekData {
  monday: string;
  days: WeekDay[];
  total: number;
}

/** Slots grupperet pr. dag for én uge. Man–fre altid; lør/søn kun hvis der er ledige tider. */
export function buildWeek(slots: Date[], monday: string): WeekData {
  const keys = Array.from({ length: 7 }, (_, i) => addDaysKey(monday, i));
  const all: WeekDay[] = keys.map((key, index) => ({ key, index, slots: [] }));
  for (const s of slots) {
    const i = keys.indexOf(localDateKey(s));
    if (i >= 0) all[i].slots.push(s);
  }
  all.forEach((d) => d.slots.sort((x, y) => x.getTime() - y.getTime()));
  const weekend = all[5].slots.length > 0 || all[6].slots.length > 0;
  return { monday, days: weekend ? all : all.slice(0, 5), total: all.reduce((n, d) => n + d.slots.length, 0) };
}

/** Mandagen i den første uge, der har ledige tider (eller null). */
export function firstWeekWithSlots(slots: Date[]): string | null {
  if (slots.length === 0) return null;
  const first = slots.reduce((a, b) => (a < b ? a : b));
  return mondayKey(localDateKey(first));
}

export interface WeekPeriodNote {
  index: number;
  /** yyyy-MM-dd, første og sidste dag i perioden */
  startKey: string;
  endKey: string;
  kind: "current" | "next" | "other";
  /** Er der stadig et møde til gode i perioden? */
  open: boolean;
}

/** Hvilke kvoteperioder berører ugen? (en uge kan krydse en periodegrænse) */
export function weekPeriods(
  monday: string,
  startedAt: Date,
  frequencyWeeks: number,
  currentPeriod: number,
  openPeriods: number[],
): WeekPeriodNote[] {
  const seen = new Map<number, WeekPeriodNote>();
  for (let i = 0; i < 7; i++) {
    const key = addDaysKey(monday, i);
    const at = new Date(`${key}T12:00:00Z`);
    const index = periodIndexAt(startedAt, at, frequencyWeeks);
    if (index < 0 || seen.has(index)) continue;
    const b = periodBounds(startedAt, index, frequencyWeeks);
    seen.set(index, {
      index,
      startKey: localDateKey(b.start),
      endKey: localDateKey(new Date(b.end.getTime() - 1)),
      kind: index === currentPeriod ? "current" : index === currentPeriod + 1 ? "next" : "other",
      open: openPeriods.includes(index),
    });
  }
  return [...seen.values()];
}

/** Kan man gå til denne uge? Fra ugen med "nu" og frem til ugen med vinduets slutning. */
export function clampWeek(monday: string, minMonday: string, maxMonday: string): string {
  if (monday < minMonday) return minMonday;
  if (monday > maxMonday) return maxMonday;
  return monday;
}
