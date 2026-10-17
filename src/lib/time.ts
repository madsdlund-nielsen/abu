import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { da } from "date-fns/locale";

export const TZ = "Europe/Copenhagen";

export function formatDateTime(d: Date): string {
  return formatInTimeZone(d, TZ, "EEEE d. MMMM yyyy 'kl.' HH:mm", { locale: da });
}

export function formatDate(d: Date): string {
  return formatInTimeZone(d, TZ, "d. MMM yyyy", { locale: da });
}

/** Kort dato til SMS: "tor. 12. nov." */
export function formatDateShort(d: Date): string {
  return formatInTimeZone(d, TZ, "EEE d. MMM", { locale: da });
}

export function formatTime(d: Date): string {
  return formatInTimeZone(d, TZ, "HH:mm");
}

export function localDateKey(d: Date): string {
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}

/** ISO-ugedag (man=1 … søn=7) for et tidspunkt i København. */
export function isoWeekday(d: Date): number {
  return Number(formatInTimeZone(d, TZ, "i"));
}

export function minutesSinceLocalMidnight(d: Date): number {
  const [h, m] = formatInTimeZone(d, TZ, "HH:mm").split(":").map(Number);
  return h * 60 + m;
}

/** Konverterer lokal dato (yyyy-MM-dd) + minutter efter midnat til UTC-Date. */
export function localToUtc(dateKey: string, minutes: number): Date {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return fromZonedTime(`${dateKey}T${h}:${m}:00`, TZ);
}

/** Dato-nøgle for dag + n dage (kalenderregning, ikke millisekunder). */
export function addDaysKey(dateKey: string, n: number): string {
  const [y, mo, da_] = dateKey.split("-").map(Number);
  const d = addDays(new Date(Date.UTC(y, mo - 1, da_)), n);
  return d.toISOString().slice(0, 10);
}

export function dayDiff(aKey: string, bKey: string): number {
  const p = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(bKey) - p(aKey)) / 86_400_000);
}

export function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 1440 ? v : null;
}

export const WEEKDAY_NAMES = ["", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];

/** Parser dansk datoformat "dd.mm.åååå" (også d.m.åååå, med . / - som skilletegn). */
export function parseDanishDate(input: string): { y: number; m: number; d: number } | null {
  const m = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*$/.exec(input);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return null;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return { y, m: mo, d };
}

export function formatDanishDateInput(d: Date): string {
  return formatInTimeZone(d, TZ, "dd.MM.yyyy");
}

/** "dd.mm.åååå" + "HH:mm" (København-tid) -> UTC-Date. Returnerer null hvis input er ugyldigt. */
export function parseDanishDateTime(dateStr: string, timeStr: string): Date | null {
  const date = parseDanishDate(dateStr);
  const minutes = hhmmToMinutes(timeStr.trim());
  if (!date || minutes === null || minutes >= 1440) return null;
  const key = `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  const out = localToUtc(key, minutes);
  return Number.isNaN(out.getTime()) ? null : out;
}
