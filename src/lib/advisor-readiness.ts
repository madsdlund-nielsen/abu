import { prisma } from "./db";

/**
 * Klar til aktivering? (ejerens beslutning, QA #13) Rådgivere aktiveres manuelt af admin. Tjeklisten vises ved
 * «Aktivér»-knappen; mangler noget, advares der, men aktivering blokeres ikke.
 */
export interface ReadinessInput {
  inviteAccepted: boolean;
  tagCount: number;
  ruleCount: number;
  bio: string;
  priceDkk: number;
  /** Tilladt prisinterval (plan #20) */
  priceBounds?: { min: number; max: number };
}

export interface ReadinessItem {
  key: "invite" | "tags" | "availability" | "bio" | "price";
  label: string;
  ok: boolean;
}

export function advisorReadiness(i: ReadinessInput): ReadinessItem[] {
  const priceOk = i.priceBounds ? i.priceDkk >= i.priceBounds.min && i.priceDkk <= i.priceBounds.max : i.priceDkk > 0;
  return [
    { key: "invite", label: "Invitation accepteret", ok: i.inviteAccepted },
    { key: "tags", label: "Mindst ét kompetence-tag", ok: i.tagCount > 0 },
    { key: "availability", label: "Ugentlig tilgængelighed", ok: i.ruleCount > 0 },
    { key: "bio", label: "Præsentation (bio)", ok: i.bio.trim().length > 0 },
    { key: "price", label: "Pris pr. møde", ok: priceOk },
  ];
}

export function missingReadiness(items: ReadinessItem[]): string[] {
  return items.filter((x) => !x.ok).map((x) => x.label.charAt(0).toLowerCase() + x.label.slice(1));
}

/** Kunder med et aktivt/afventende board, som rådgiveren sidder i (advarsel ved deaktivering). */
export async function boardsWithAdvisor(advisorId: string): Promise<{ subscriptionId: string; companyName: string; status: string }[]> {
  const rows = await prisma.subscriptionAdvisor.findMany({
    where: { advisorId, subscription: { status: { in: ["ACTIVE", "PAST_DUE", "PENDING"] } } },
    select: { subscription: { select: { id: true, status: true, customer: { select: { companyName: true } } } } },
  });
  return rows
    .map((r) => ({ subscriptionId: r.subscription.id, companyName: r.subscription.customer.companyName, status: r.subscription.status }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName, "da"));
}

/** Tjeklisten for flere rådgivere på én gang (admin-listen). */
export async function loadReadiness(advisorIds: string[], priceBounds?: { min: number; max: number }): Promise<Map<string, ReadinessItem[]>> {
  const profiles = await prisma.advisorProfile.findMany({
    where: { userId: { in: advisorIds } },
    select: { userId: true, bio: true, pricePerMeetingDkk: true, user: { select: { passwordHash: true } }, _count: { select: { tags: true, availabilityRules: true } } },
  });
  return new Map(
    profiles.map((p) => [
      p.userId,
      advisorReadiness({
        inviteAccepted: Boolean(p.user.passwordHash),
        tagCount: p._count.tags,
        ruleCount: p._count.availabilityRules,
        bio: p.bio,
        priceDkk: p.pricePerMeetingDkk,
        priceBounds,
      }),
    ]),
  );
}
