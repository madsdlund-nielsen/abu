import { prisma } from "../db";
import { FREQUENCY_WEEKS, monthlyPriceForBoard, isFrequencyWeeks } from "../pricing";

export interface ResolvedBoard {
  weeks: number;
  advisors: { id: string; name: string; pricePerMeetingDkk: number }[];
  monthlyPriceDkk: number;
  perMeetingDkk: number;
}

/** Validerer et valgt board mod databasen og beregner prisen med rådgivernes aktuelle priser. */
export async function resolveBoard(advisorIds: string[], weeks: number): Promise<ResolvedBoard | { error: string }> {
  const ids = [...new Set(advisorIds)];
  if (ids.length < 2 || ids.length > 4) return { error: "Vælg mellem 2 og 4 rådgivere." };
  if (!isFrequencyWeeks(weeks)) return { error: `Vælg hvor ofte I vil mødes (hver ${FREQUENCY_WEEKS.join(".")}. uge).` };
  const profiles = await prisma.advisorProfile.findMany({ where: { userId: { in: ids }, active: true }, include: { user: true } });
  if (profiles.length !== ids.length) return { error: "En af de valgte rådgivere er ikke længere tilgængelig. Vælg igen." };
  const advisors = ids.map((id) => {
    const p = profiles.find((x) => x.userId === id)!;
    return { id, name: p.user.name, pricePerMeetingDkk: p.pricePerMeetingDkk };
  });
  const prices = advisors.map((a) => a.pricePerMeetingDkk);
  return {
    weeks,
    advisors,
    monthlyPriceDkk: monthlyPriceForBoard(prices, weeks),
    perMeetingDkk: prices.reduce((a, b) => a + b, 0),
  };
}
