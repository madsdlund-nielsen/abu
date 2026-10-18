import { prisma } from "./db";
import { userDirectory } from "./user-directory";
import { deleteOnboardingSessionsForEmail } from "./onboarding/session";

const include = {
  advisors: { include: { advisor: true } },
  customer: { include: { user: true } },
} as const;

/**
 * Kundens aktuelle (ikke opsagte) abonnement; nyeste først, aktive foran afventende. Rådgivernes navne kommer fra
 * kataloget (RLS: kunden kan ikke læse rådgivernes User-rækker, kun navn og rolle via rls.user_directory).
 */
export async function getCustomerSubscription(userId: string) {
  const subs = await prisma.subscription.findMany({
    where: { customerId: userId, status: { in: ["ACTIVE", "PAST_DUE", "PENDING"] } },
    include,
    orderBy: { createdAt: "desc" },
  });
  const sub = subs.find((s) => s.status !== "PENDING") ?? subs[0] ?? null;
  if (!sub) return null;
  const names = await userDirectory(sub.advisors.map((a) => a.advisorId));
  return {
    ...sub,
    advisors: sub.advisors.map((a) => ({ ...a, advisor: { ...a.advisor, user: names.get(a.advisorId) ?? { id: a.advisorId, name: "", role: "ADVISOR" as const } } })),
  };
}

/** Kundens behov fra onboarding-testen (snapshot på kundeprofilen), begrænset til aktive tags. */
export async function getCustomerNeeds(userId: string): Promise<Record<string, number>> {
  const [profile, tags] = await Promise.all([
    prisma.customerProfile.findUnique({ where: { userId }, select: { testAnswers: true } }),
    prisma.tag.findMany({ where: { active: true }, select: { id: true } }),
  ]);
  const active = new Set(tags.map((t) => t.id));
  const needs = (profile?.testAnswers as { needs?: { tagId: string; weight: number }[] } | null)?.needs ?? [];
  return Object.fromEntries(needs.filter((n) => active.has(n.tagId)).map((n) => [n.tagId, n.weight]));
}

/** Efter aktivering: onboarding-data er flyttet til kontoen og slettes (GDPR). Kaldes fra webhook og mock-betaling. */
export async function afterSubscriptionActivated(subscriptionId: string): Promise<void> {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId }, select: { customer: { select: { user: { select: { email: true } } } } } });
  if (sub) await deleteOnboardingSessionsForEmail(sub.customer.user.email);
}
