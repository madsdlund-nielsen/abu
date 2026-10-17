/**
 * Prisfastsættelse for Advisory Board Unlimited.
 *
 * Månedspris = rådgivere × 1750 × (52 / uger) / 12, afrundet til hele kroner.
 * Priserne antages at være ekskl. moms (B2B).
 */
export const PRICE_PER_ADVISOR_PER_MEETING_DKK = 1750;
export const ADVISOR_COUNTS = [2, 3, 4] as const;
export const FREQUENCY_WEEKS = [4, 8, 12] as const;

export type AdvisorCount = (typeof ADVISOR_COUNTS)[number];
export type FrequencyWeeks = (typeof FREQUENCY_WEEKS)[number];

export function isAdvisorCount(n: number): n is AdvisorCount {
  return (ADVISOR_COUNTS as readonly number[]).includes(n);
}

export function isFrequencyWeeks(n: number): n is FrequencyWeeks {
  return (FREQUENCY_WEEKS as readonly number[]).includes(n);
}

export function monthlyPriceDkk(advisors: number, weeks: number): number {
  if (!isAdvisorCount(advisors)) throw new Error(`Ugyldigt antal rådgivere: ${advisors}`);
  if (!isFrequencyWeeks(weeks)) throw new Error(`Ugyldig frekvens: ${weeks}`);
  return Math.round((advisors * PRICE_PER_ADVISOR_PER_MEETING_DKK * (52 / weeks)) / 12);
}

/** Frisbii-plan-handle: abu-{rådgivere}a-{uger}w, fx abu-3a-8w */
export function planHandle(advisors: number, weeks: number): string {
  if (!isAdvisorCount(advisors) || !isFrequencyWeeks(weeks)) {
    throw new Error("Ugyldig plan");
  }
  return `abu-${advisors}a-${weeks}w`;
}

export function formatDkk(amount: number): string {
  return new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 }).format(amount) + " kr.";
}

export function frequencyLabel(weeks: number): string {
  return `Hver ${weeks}. uge`;
}
