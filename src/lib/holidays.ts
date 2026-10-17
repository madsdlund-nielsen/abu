import { prisma } from "./db";
import { addDaysKey, localDateKey } from "./time";

/**
 * Danske helligdage (plan #24), beregnet i koden – også de påskeafhængige. Store Bededag er afskaffet fra og med 2024
 * (lov nr. 54 af 28.02.2023) og indgår kun for årene før. Juleaftensdag og nytårsaftensdag er ikke helligdage, men
 * spærres som standard (kan slås fra); grundlovsdag kan slås til. Admin kan slå enkelte datoer til og fra.
 */
export interface Holiday {
  /** yyyy-MM-dd (dansk dato) */
  date: string;
  key: string;
  name: string;
  /** false = officiel helligdag; true = lukkedag, der kan vælges til/fra */
  optional: boolean;
  /** Spærret for booking, hvis admin ikke har ændret det */
  defaultBlocked: boolean;
}

/** Påskedag (gregoriansk, "anonym" algoritme / Meeus-Jones-Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const STORE_BEDEDAG_LAST_YEAR = 2023;

export function danishHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const e = (offset: number) => addDaysKey(easter, offset);
  const fixed = (md: string) => `${year}-${md}`;
  const official = (date: string, key: string, name: string): Holiday => ({ date, key, name, optional: false, defaultBlocked: true });
  const list: Holiday[] = [
    official(fixed("01-01"), "nytaarsdag", "Nytårsdag"),
    official(e(-3), "skaertorsdag", "Skærtorsdag"),
    official(e(-2), "langfredag", "Langfredag"),
    official(easter, "paaskedag", "Påskedag"),
    official(e(1), "2-paaskedag", "2. påskedag"),
    ...(year <= STORE_BEDEDAG_LAST_YEAR ? [official(e(26), "store-bededag", "Store bededag")] : []),
    official(e(39), "kristi-himmelfart", "Kristi himmelfartsdag"),
    official(e(49), "pinsedag", "Pinsedag"),
    official(e(50), "2-pinsedag", "2. pinsedag"),
    { date: fixed("06-05"), key: "grundlovsdag", name: "Grundlovsdag", optional: true, defaultBlocked: false },
    { date: fixed("12-24"), key: "juleaften", name: "Juleaftensdag", optional: true, defaultBlocked: true },
    official(fixed("12-25"), "juledag", "Juledag"),
    official(fixed("12-26"), "2-juledag", "2. juledag"),
    { date: fixed("12-31"), key: "nytaarsaften", name: "Nytårsaftensdag", optional: true, defaultBlocked: true },
  ];
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/** Overstyringer fra admin: dato → spærret (true) / åben (false). */
export type HolidayOverrides = Record<string, boolean>;

export function isHolidayBlocked(h: Holiday, overrides: HolidayOverrides): boolean {
  return overrides[h.date] ?? h.defaultBlocked;
}

/** Spærrede datoer i årene (ren funktion). */
export function blockedDates(years: number[], overrides: HolidayOverrides): Set<string> {
  return new Set(years.flatMap((y) => danishHolidays(y)).filter((h) => isHolidayBlocked(h, overrides)).map((h) => h.date));
}

const KEY = "holidays.overrides";

export async function getHolidayOverrides(): Promise<HolidayOverrides> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return {};
  try {
    const v = JSON.parse(row.value) as unknown;
    if (!v || typeof v !== "object") return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, b]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && typeof b === "boolean")) as HolidayOverrides;
  } catch {
    return {};
  }
}

/** Sætter (eller fjerner, når den svarer til standarden) en overstyring for én helligdag. */
export async function setHolidayBlocked(date: string, blocked: boolean): Promise<void> {
  const year = Number(date.slice(0, 4));
  const h = danishHolidays(year).find((x) => x.date === date);
  if (!h) throw new Error("Datoen er ikke en kendt helligdag.");
  const overrides = await getHolidayOverrides();
  if (blocked === h.defaultBlocked) delete overrides[date];
  else overrides[date] = blocked;
  // Gamle år ryddes væk
  const minYear = new Date().getFullYear() - 1;
  for (const k of Object.keys(overrides)) if (Number(k.slice(0, 4)) < minYear) delete overrides[k];
  const value = JSON.stringify(overrides);
  await prisma.appSetting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
}

/** Spærrede datoer (dansk dato) i et tidsrum – til booking. */
export async function getBlockedDates(from: Date, to: Date): Promise<Set<string>> {
  const first = Number(localDateKey(from).slice(0, 4));
  const last = Number(localDateKey(to).slice(0, 4));
  const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  return blockedDates(years, await getHolidayOverrides());
}
