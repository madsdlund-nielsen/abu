import { addDaysKey, localDateKey, localToUtc, minutesSinceLocalMidnight } from "../time";
import type { TimingKind } from "./triggers";

export type TimingUnit = "minutes" | "hours" | "days";
export type TimingDirection = "before" | "after";

export interface TimingParts {
  amount: number;
  unit: TimingUnit;
  direction: TimingDirection;
}

const UNIT_MINUTES: Record<TimingUnit, number> = { minutes: 1, hours: 60, days: 1440 };

export const MAX_OFFSET_MINUTES = 60 * 1440;

/** (antal + enhed + før/efter) -> minutter. Før er negativ. */
export function partsToOffset(p: TimingParts): number {
  const minutes = Math.round(p.amount) * UNIT_MINUTES[p.unit];
  return p.direction === "before" ? -minutes : minutes;
}

/** Minutter -> den mest naturlige (antal + enhed): 1440 -> 24 timer, 4320 -> 3 dage, 90 -> 90 minutter. */
export function offsetToParts(offsetMinutes: number): TimingParts {
  const direction: TimingDirection = offsetMinutes < 0 ? "before" : "after";
  const abs = Math.abs(offsetMinutes);
  if (abs >= 2 * 1440 && abs % 1440 === 0) return { amount: abs / 1440, unit: "days", direction };
  if (abs >= 60 && abs % 60 === 0) return { amount: abs / 60, unit: "hours", direction };
  return { amount: abs, unit: "minutes", direction };
}

const UNIT_LABEL: Record<TimingUnit, [string, string]> = {
  minutes: ["minut", "minutter"],
  hours: ["time", "timer"],
  days: ["dag", "dage"],
};

export function unitLabel(unit: TimingUnit, amount: number): string {
  return UNIT_LABEL[unit][amount === 1 ? 0 : 1];
}

const ANCHOR_LABEL: Record<TimingKind, { before: string; after: string }> = {
  before_start: { before: "før mødets start", after: "efter mødets start" },
  event: { before: "før hændelsen", after: "efter hændelsen" },
  after_activity: { before: "før sidste aktivitet", after: "efter sidste aktivitet" },
};

export function anchorLabel(kind: TimingKind, direction: TimingDirection): string {
  return ANCHOR_LABEL[kind][direction];
}

/** Menneskelig beskrivelse: "24 timer før mødets start", "Straks", "3 dage efter sidste aktivitet". */
export function describeTiming(kind: TimingKind, offsetMinutes: number): string {
  if (offsetMinutes === 0) return kind === "before_start" ? "Ved mødets start" : "Straks";
  const p = offsetToParts(offsetMinutes);
  return `${p.amount} ${unitLabel(p.unit, p.amount)} ${anchorLabel(kind, p.direction)}`;
}

/** Hvilke retninger giver mening for en udløsertype? */
export function allowedDirections(kind: TimingKind): TimingDirection[] {
  return kind === "before_start" ? ["before"] : ["after"];
}

/** Er offsetten gyldig for udløsertypen? Returnerer en fejltekst ellers. */
export function validateOffset(kind: TimingKind, offsetMinutes: number): string | null {
  if (!Number.isInteger(offsetMinutes)) return "Tiden skal være et helt antal minutter.";
  if (Math.abs(offsetMinutes) > MAX_OFFSET_MINUTES) return "Tiden må højst være 60 dage.";
  if (kind === "before_start" && offsetMinutes > 0) return "En påmindelse skal sendes før mødets start.";
  if (kind !== "before_start" && offsetMinutes < 0) return "Denne udløser kan kun sende straks eller efter hændelsen.";
  return null;
}

export function fireTime(anchor: Date, offsetMinutes: number): Date {
  return new Date(anchor.getTime() + offsetMinutes * 60_000);
}

// --------------------------------------------------------------------------- Stille timer

export interface QuietHours {
  /** Hel time (0-23) hvor de stille timer begynder */
  startHour: number;
  /** Hel time (0-23) hvor de slutter */
  endHour: number;
}

/** "21-08" -> { startHour: 21, endHour: 8 }. Tom, "off" eller start = slut betyder ingen stille timer. */
export function parseQuietHours(value: string | null | undefined): QuietHours | null {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(value ?? "");
  if (!m) return null;
  const startHour = Number(m[1]);
  const endHour = Number(m[2]);
  if (startHour > 23 || endHour > 23 || startHour === endHour) return null;
  return { startHour, endHour };
}

export function formatQuietHours(q: QuietHours | null): string {
  return q ? `${String(q.startHour).padStart(2, "0")}-${String(q.endHour).padStart(2, "0")}` : "off";
}

/** Ligger tidspunktet (København-tid) i de stille timer? */
export function isQuiet(at: Date, q: QuietHours): boolean {
  const m = minutesSinceLocalMidnight(at);
  const s = q.startHour * 60;
  const e = q.endHour * 60;
  return s > e ? m >= s || m < e : m >= s && m < e;
}

/** Første tilladte tidspunkt efter de stille timer (kl. slut-time, København-tid). */
export function nextAllowed(at: Date, q: QuietHours): Date {
  if (!isQuiet(at, q)) return at;
  const m = minutesSinceLocalMidnight(at);
  const key = localDateKey(at);
  const wraps = q.startHour > q.endHour;
  const day = wraps && m >= q.startHour * 60 ? addDaysKey(key, 1) : key;
  return localToUtc(day, q.endHour * 60);
}

/** Påmindelser tættere på mødet end dette sendes uanset stille timer. */
export const QUIET_EXEMPT_MINUTES = 120;

export interface QuietAdjust {
  /** null = send ikke (fx stille timer rækker ind i mødet) */
  at: Date | null;
  delayed: boolean;
}

/**
 * Udsætter en SMS til efter de stille timer. Undtaget: påmindelser under 2 timer før mødet. Hvis udskydelsen
 * rækker til eller forbi mødets start, sendes den ikke.
 */
export function adjustForQuietHours(opts: {
  at: Date;
  channel: "EMAIL" | "SMS";
  ruleQuiet: boolean;
  quiet: QuietHours | null;
  meetingStart?: Date;
}): QuietAdjust {
  const { at, channel, ruleQuiet, quiet, meetingStart } = opts;
  if (channel !== "SMS" || !ruleQuiet || !quiet || !isQuiet(at, quiet)) return { at, delayed: false };
  if (meetingStart && meetingStart.getTime() - at.getTime() < QUIET_EXEMPT_MINUTES * 60_000) return { at, delayed: false };
  const next = nextAllowed(at, quiet);
  if (meetingStart && next >= meetingStart) return { at: null, delayed: true };
  return { at: next, delayed: true };
}
