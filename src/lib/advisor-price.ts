import { prisma } from "./db";

/**
 * Grænser for rådgiverens pris pr. møde (QA, plan #20): beskytter mod fejlindtastninger som 0-5 kr. og dermed mod
 * abonnementer på 0 kr. hos betalingsudbyderen. Kan ændres af admin (AppSetting), standard 500-25.000 kr.
 */
export interface PriceBounds {
  min: number;
  max: number;
}

export const DEFAULT_PRICE_BOUNDS: PriceBounds = { min: 500, max: 25000 };
export const PRICE_BOUNDS_LIMIT = 100000;
const KEYS = { min: "advisor.priceMinDkk", max: "advisor.priceMaxDkk" } as const;

const fmt = (n: number) => new Intl.NumberFormat("da-DK").format(n);

/** null = gyldig pris. */
export function validateAdvisorPrice(price: number, bounds: PriceBounds): string | null {
  if (!Number.isInteger(price)) return "Prisen skal være et helt antal kroner.";
  if (price < bounds.min || price > bounds.max) return `Prisen skal ligge mellem ${fmt(bounds.min)} og ${fmt(bounds.max)} kr. pr. møde.`;
  return null;
}

export function validatePriceBounds(b: PriceBounds): string | null {
  if (!Number.isInteger(b.min) || !Number.isInteger(b.max)) return "Grænserne skal være hele kroner.";
  if (b.min < 1) return "Mindsteprisen skal være mindst 1 kr.";
  if (b.max > PRICE_BOUNDS_LIMIT) return `Maksprisen må højst være ${fmt(PRICE_BOUNDS_LIMIT)} kr.`;
  if (b.min >= b.max) return "Mindsteprisen skal være lavere end maksprisen.";
  return null;
}

export async function getPriceBounds(): Promise<PriceBounds> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [KEYS.min, KEYS.max] } } });
  const v = (k: string, d: number) => {
    const n = Number(rows.find((r) => r.key === k)?.value);
    return Number.isInteger(n) ? n : d;
  };
  const b = { min: v(KEYS.min, DEFAULT_PRICE_BOUNDS.min), max: v(KEYS.max, DEFAULT_PRICE_BOUNDS.max) };
  return validatePriceBounds(b) ? DEFAULT_PRICE_BOUNDS : b;
}

export async function savePriceBounds(b: PriceBounds): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const k of Object.keys(KEYS) as (keyof PriceBounds)[]) {
      await tx.appSetting.upsert({ where: { key: KEYS[k] }, update: { value: String(b[k]) }, create: { key: KEYS[k], value: String(b[k]) } });
    }
  });
}
