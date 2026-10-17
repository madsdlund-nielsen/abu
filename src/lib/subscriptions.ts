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
