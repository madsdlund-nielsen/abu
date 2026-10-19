import { prisma } from "../db";
import { leadEligibleIds, NO_LEAD_ELIGIBLE_ERROR } from "../lead";
import { FREQUENCY_WEEKS, monthlyPriceForBoard, isFrequencyWeeks } from "../pricing";
import { nameOf, userDirectory } from "../user-directory";

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
  const profiles = await prisma.advisorProfile.findMany({ where: { userId: { in: ids }, active: true }, select: { userId: true, pricePerMeetingDkk: true } });
  if (profiles.length !== ids.length) return { error: "En af de valgte rådgivere er ikke længere tilgængelig. Vælg igen." };
  // RLS: navnene fra kataloget (aktive rådgivere er offentlige; User-rækkerne er ikke)
  const names = await userDirectory(ids);
  // Mindst én rådgiver, der kan være ansvarlig rådgiver (lead-tagget)
  if ((await leadEligibleIds(ids)).size === 0) return { error: NO_LEAD_ELIGIBLE_ERROR };
  const advisors = ids.map((id) => {
    const p = profiles.find((x) => x.userId === id)!;
    return { id, name: nameOf(names, id, ""), pricePerMeetingDkk: p.pricePerMeetingDkk };
  });
  const prices = advisors.map((a) => a.pricePerMeetingDkk);
  return {
    weeks,
    advisors,
    monthlyPriceDkk: monthlyPriceForBoard(prices, weeks),
    perMeetingDkk: prices.reduce((a, b) => a + b, 0),
  };
}
