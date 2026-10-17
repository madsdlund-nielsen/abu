import type { Metadata } from "next";
import Link from "next/link";
import { cancelSubscriptionAction, changePlanAction } from "@/app/actions/subscription";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { PlanPicker } from "@/components/plan-picker";
import { SubStatusBadge } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDkk, frequencyLabel } from "@/lib/pricing";
import { getCustomerSubscription, listActiveAdvisors } from "@/lib/subscriptions";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Abonnement" };

export default async function SubscriptionPage({ searchParams }: { searchParams: SP }) {
  const user = await requireRole("CUSTOMER");
  const { ok, err } = await flashFrom(searchParams);
  const sub = await getCustomerSubscription(user.id);
  const advisors = await listActiveAdvisors();
  const manageable = sub && (sub.status === "ACTIVE" || sub.status === "PAST_DUE");

  return (
    <div className="space-y-6">
      <h1>Abonnement</h1>
      <Flash ok={ok} err={err} />
      {!sub ? (
        <div className="card">
          <p className="text-sm">Du har intet abonnement endnu.</p>
          <Link href="/subscribe" className="btn mt-3">Vælg abonnement</Link>
        </div>
      ) : (
        <section className="card">
          <div className="flex items-center justify-between gap-3">
            <h2>Nuværende plan</h2>
            <SubStatusBadge status={sub.status} />
          </div>
          <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Rådgivere</dt><dd>{sub.advisorCount}</dd></div>
            <div><dt className="text-muted">Frekvens</dt><dd>{frequencyLabel(sub.frequencyWeeks)}</dd></div>
            <div><dt className="text-muted">Pris</dt><dd>{formatDkk(sub.monthlyPriceDkk)} / md. ekskl. moms</dd></div>
            {sub.startedAt && <div><dt className="text-muted">Startet</dt><dd>{formatDate(sub.startedAt)}</dd></div>}
            <div className="sm:col-span-2">
              <dt className="text-muted">Dit board</dt>
              <dd>{sub.advisors.map((a) => a.advisor.user.name).join(", ")}</dd>
            </div>
          </dl>
          {sub.status === "PAST_DUE" && (
            <p className="callout callout-error mt-3 text-sm">
              Seneste betaling mislykkedes. Opdater dit betalingskort hos Frisbii; du kan ikke booke nye møder, før betalingen er gået igennem.
            </p>
          )}
          {sub.status === "PENDING" && <p className="mt-3 text-sm text-muted"><Link href="/subscribe">Fuldfør tilmelding</Link></p>}
        </section>
      )}

      {manageable && sub && (
        <>
          <section>
            <h2 className="mb-3">Skift plan</h2>
            <PlanPicker
              advisors={advisors.map((a) => ({ id: a.userId, name: a.user.name, title: a.title, bio: a.bio, expertise: a.expertise }))}
              action={changePlanAction}
              submitLabel="Gem ny plan"
              initialCount={sub.advisorCount}
              initialWeeks={sub.frequencyWeeks}
              initialSelected={sub.advisors.map((a) => a.advisorId)}
            />
          </section>
          <section className="card">
            <h2>Opsig abonnement</h2>
            <p className="mt-2 text-sm text-muted">Kommende møder aflyses, og abonnementet stoppes hos betalingsudbyderen.</p>
            <form action={cancelSubscriptionAction} className="mt-3">
              <button className="btn-danger" type="submit">Opsig abonnement</button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
