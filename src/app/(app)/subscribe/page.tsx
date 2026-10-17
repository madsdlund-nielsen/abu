import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { startSubscriptionAction } from "@/app/actions/subscription";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { PlanPicker } from "@/components/plan-picker";
import { requireRole } from "@/lib/auth";
import { getCustomerSubscription, listActiveAdvisors } from "@/lib/subscriptions";

export const metadata: Metadata = { title: "Vælg abonnement" };

export default async function SubscribePage({ searchParams }: { searchParams: SP }) {
  const user = await requireRole("CUSTOMER");
  const { ok, err } = await flashFrom(searchParams);
  const existing = await getCustomerSubscription(user.id);
  if (existing && existing.status !== "PENDING") redirect("/account/subscription");
  const advisors = await listActiveAdvisors();
  return (
    <div>
      <h1>Sammensæt dit advisory board</h1>
      <p className="mb-6 mt-2 text-muted">Vælg antal rådgivere, mødefrekvens og hvilke rådgivere der skal sidde i dit board.</p>
      <Flash ok={ok} err={err} />
      <PlanPicker
        advisors={advisors.map((a) => ({
          id: a.userId,
          name: a.user.name,
          title: a.title,
          bio: a.bio,
          expertise: a.expertise,
        }))}
        action={startSubscriptionAction}
        submitLabel="Fortsæt til betaling"
      />
    </div>
  );
}
