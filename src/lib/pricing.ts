/**
 * Prisfastsættelse for Advisory Board Unlimited.
 *
 * Månedspris = sum(rådgiverens pris pr. møde) × (52 / uger) / 12, afrundet til hele kroner.
 * Hver rådgiver har sin egen mødepris (sættes af admin; standard 1.750 kr.). Alle priser er ekskl. moms (bekræftet af ejer).
 */
export const DEFAULT_PRICE_PER_MEETING_DKK = 1750;
/** @deprecated brug DEFAULT_PRICE_PER_MEETING_DKK */
export const PRICE_PER_ADVISOR_PER_MEETING_DKK = DEFAULT_PRICE_PER_MEETING_DKK;
export const VAT_RATE = 0.25;
export const MIN_BOARD_SIZE = 2;
export const MAX_BOARD_SIZE = 4;
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

/** Månedspris for et board med individuelle mødepriser. */
export function monthlyPriceForBoard(prices: readonly number[], weeks: number): number {
  if (!isAdvisorCount(prices.length)) throw new Error(`Ugyldigt antal rådgivere: ${prices.length}`);
  if (!isFrequencyWeeks(weeks)) throw new Error(`Ugyldig frekvens: ${weeks}`);
  if (prices.some((p) => !Number.isFinite(p) || p < 0)) throw new Error("Ugyldig mødepris");
  const perMeeting = prices.reduce((a, b) => a + b, 0);
  return Math.round((perMeeting * (52 / weeks)) / 12);
}

/** Månedspris når alle rådgivere koster standardprisen (bruges til "fra"-priser). */
export function monthlyPriceDkk(advisors: number, weeks: number): number {
  if (!isAdvisorCount(advisors)) throw new Error(`Ugyldigt antal rådgivere: ${advisors}`);
  return monthlyPriceForBoard(Array<number>(advisors).fill(DEFAULT_PRICE_PER_MEETING_DKK), weeks);
}

/** Moms af et beløb ekskl. moms (25 %, afrundet til hele kroner). */
export function vatBreakdown(exVat: number) {
  const vat = Math.round(exVat * VAT_RATE);
  return { exVat, vat, incVat: exVat + vat };
}

/** Frisbii-plan-handle: én plan pr. frekvens, abu-{uger}w, fx abu-8w. Beløbet sættes pr. abonnement. */
export function planHandle(weeks: number): string {
  if (!isFrequencyWeeks(weeks)) throw new Error("Ugyldig plan");
  return `abu-${weeks}w`;
}

export function formatDkk(amount: number): string {
  return new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 }).format(amount) + " kr.";
}

export function frequencyLabel(weeks: number): string {
  return `Hver ${weeks}. uge`;
}
