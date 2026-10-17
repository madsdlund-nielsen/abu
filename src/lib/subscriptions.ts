import { prisma } from "./db";

const include = {
  advisors: { include: { advisor: { include: { user: true } } } },
  customer: { include: { user: true } },
} as const;

/** Kundens aktuelle (ikke opsagte) abonnement; nyeste først, aktive foran afventende. */
export async function getCustomerSubscription(userId: string) {
  const subs = await prisma.subscription.findMany({
    where: { customerId: userId, status: { in: ["ACTIVE", "PAST_DUE", "PENDING"] } },
    include,
    orderBy: { createdAt: "desc" },
  });
  return subs.find((s) => s.status !== "PENDING") ?? subs[0] ?? null;
}

export async function listActiveAdvisors() {
  return prisma.advisorProfile.findMany({
    where: { active: true },
    include: { user: true },
    orderBy: { user: { name: "asc" } },
  });
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
