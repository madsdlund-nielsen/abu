import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { startSubscriptionAction } from "@/app/actions/subscription";
import { PageTitle } from "@/components/band";
import { BoardBuilder } from "@/components/board-builder";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { requireRole } from "@/lib/auth";
import { loadCatalog } from "@/lib/onboarding/catalog";
import { getCustomerNeeds, getCustomerSubscription } from "@/lib/subscriptions";

export const metadata: Metadata = { title: "Vælg abonnement" };

/** Bruges af kunder, der mangler et aktivt abonnement (fx afbrudt betaling). Nye kunder starter i /kom-i-gang. */
export default async function SubscribePage({ searchParams }: { searchParams: SP }) {
  const user = await requireRole("CUSTOMER");
  const { ok, err } = await flashFrom(searchParams);
  const existing = await getCustomerSubscription(user.id);
  if (existing && existing.status !== "PENDING") redirect("/account/subscription");
  const [catalog, needs] = await Promise.all([loadCatalog(), getCustomerNeeds(user.id)]);
  return (
    <div>
      <PageTitle>Sammensæt dit advisory board</PageTitle>
      <Flash ok={ok} err={err} />
      <BoardBuilder
        advisors={catalog.advisors}
        tags={catalog.tags}
        needs={needs}
        initialAdvisorIds={existing?.advisors.map((a) => a.advisorId) ?? []}
        initialWeeks={existing?.frequencyWeeks ?? null}
        action={startSubscriptionAction}
        submitLabel="Fortsæt til betaling"
        intro="Vælg 2-4 rådgivere og hvor ofte I vil mødes. Prisen opdateres med det samme."
      />
    </div>
  );
}
