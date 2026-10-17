import type { Metadata } from "next";
import Link from "next/link";
import { cancelSubscriptionAction, changePlanAction } from "@/app/actions/subscription";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { BoardBuilder } from "@/components/board-builder";
import { SubStatusBadge } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadCatalog } from "@/lib/onboarding/catalog";
import { formatDkk, frequencyLabel } from "@/lib/pricing";
import { getCustomerNeeds, getCustomerSubscription } from "@/lib/subscriptions";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Abonnement" };

export default async function SubscriptionPage({ searchParams }: { searchParams: SP }) {
  const user = await requireRole("CUSTOMER");
  const { ok, err } = await flashFrom(searchParams);
  const sub = await getCustomerSubscription(user.id);
  const manageable = sub && (sub.status === "ACTIVE" || sub.status === "PAST_DUE");
  const [catalog, needs] = manageable ? await Promise.all([loadCatalog(), getCustomerNeeds(user.id)]) : [null, {}];

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
              <dd>{sub.advisors.map((a) => `${a.advisor.user.name} (${formatDkk(a.pricePerMeetingDkk)} pr. møde)`).join(", ")}</dd>
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

      {manageable && sub && catalog && (
        <>
          <section>
            <span className="eyebrow">Skift board</span>
            <h2 className="section-title !text-[length:var(--fs-h3)] mb-3">Ret rådgivere og frekvens</h2>
            <p className="mb-space-4 max-w-2xl text-sm text-muted">
              Ved planskift bruges rådgivernes aktuelle priser. Ændrede priser påvirker kun nye abonnementer og planskift.
            </p>
            <BoardBuilder
              advisors={catalog.advisors}
              tags={catalog.tags}
              needs={needs}
              action={changePlanAction}
              submitLabel="Gem ændringer"
              initialAdvisorIds={sub.advisors.map((a) => a.advisorId)}
              initialWeeks={sub.frequencyWeeks}
            />
          </section>
          <section className="card">
            <h2>Opsig abonnement</h2>
            <p className="mt-2 text-sm text-muted">Kommende møder aflyses, og abonnementet stoppes hos betalingsudbyderen.</p>
            <form action={cancelSubscriptionAction} className="mt-3" data-confirm="Vil du opsige abonnementet? Kommende møder aflyses.">
              <button className="btn-danger" type="submit">Opsig abonnement</button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
