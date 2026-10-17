import { cache } from "react";
import { prisma } from "../db";
import { RECORDING_CONSENT_KEY, MARKETING_CONSENT_KEY, resolveTexts, consentVersion, type OnboardingTexts } from "./onboarding-texts";

/** Alle onboarding-tekster (standard + ændringer fra CMS'et). Pr. forespørgsel cachet. */
export const getOnboardingTexts = cache(async (): Promise<OnboardingTexts> => {
  const rows = await prisma.contentBlock.findMany();
  return resolveTexts(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

/** Samtykketekst + version, som den vises lige nu (til snapshot ved samtykke). */
export async function currentConsent(kind: "marketing" | "recording"): Promise<{ text: string; version: string }> {
  const key = kind === "marketing" ? MARKETING_CONSENT_KEY : RECORDING_CONSENT_KEY;
  const [texts, row] = await Promise.all([getOnboardingTexts(), prisma.contentBlock.findUnique({ where: { key } })]);
  return { text: texts[key], version: consentVersion(kind === "marketing" ? "m" : "r", row) };
}
