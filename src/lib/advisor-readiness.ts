import { prisma } from "./db";

/**
 * Klar til aktivering? (QA #13) Rådgivere aktiveres manuelt af admin, og **aktivering er blokeret, indtil hele
 * tjeklisten er opfyldt** (ejerens beslutning 18.10.2026 – tidligere kun en advarsel): invitation accepteret, mindst ét
 * tag, ugentlig tilgængelighed, bio og en pris inden for det tilladte interval. Blokeringen håndhæves på serveren
 * (`setAdvisorActive` i `advisor-activation.ts`), og UI'et viser det samme via `canActivate`.
 *
 * Deaktivering er altid tilladt. Holder en aktiv rådgiver senere op med at være klar (fx fjerner sit sidste tidsrum),
 * deaktiveres vedkommende ikke automatisk; admin ser i stedet «Aktiv – mangler: …» i listen og på detaljesiden.
 */
export interface ReadinessInput {
  inviteAccepted: boolean;
  /** Antal kompetence-tags (interne admin-tags tæller ikke) */
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

/** Må rådgiveren aktiveres? Kun når alle punkter er opfyldt (en tom liste – fx ukendt rådgiver – er aldrig klar). */
export function canActivate(items: ReadinessItem[]): boolean {
  return items.length > 0 && items.every((x) => x.ok);
}

/** Dansk fejlbesked, når aktivering afvises. */
export function activationBlockedMessage(name: string, missing: string[]): string {
  return `${name} kan ikke aktiveres endnu. Mangler: ${missing.join(", ")}.`;
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

/** Tjeklisten for flere rådgivere på én gang (admin-listen). Læser altid den gemte tilstand i databasen. */
export async function loadReadiness(advisorIds: string[], priceBounds?: { min: number; max: number }): Promise<Map<string, ReadinessItem[]>> {
  const profiles = await prisma.advisorProfile.findMany({
    where: { userId: { in: advisorIds } },
    select: { userId: true, bio: true, pricePerMeetingDkk: true, user: { select: { passwordHash: true } }, _count: { select: { tags: { where: { tag: { kind: "COMPETENCE" } } }, availabilityRules: true } } },
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
