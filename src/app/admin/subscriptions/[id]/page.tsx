import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminChangeBoardAction, setLeadAction } from "@/app/actions/admin-meetings";
import { BoardBuilder } from "@/components/board-builder";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { SubStatusBadge } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadCatalog } from "@/lib/onboarding/catalog";
import { formatDkk, frequencyLabel } from "@/lib/pricing";
import { getCustomerNeeds } from "@/lib/subscriptions";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Rediger board" };
export const dynamic = "force-dynamic";

export default async function AdminSubscription({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const { ok, err } = await flashFrom(searchParams);
  const sub = await prisma.subscription.findUnique({
    where: { id },
    include: {
      customer: true,
      advisors: { include: { advisor: { include: { user: true } } } },
      meetings: { where: { status: "BOOKED", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, include: { participants: { include: { user: true } } } },
    },
  });
  if (!sub) notFound();
  const [catalog, needs] = await Promise.all([loadCatalog({ includeIds: sub.advisors.map((a) => a.advisorId), viewer: await requireRole("ADMIN") }), getCustomerNeeds(sub.customerId)]);
  const editable = sub.status !== "CANCELLED";
  const lead = sub.advisors.find((a) => a.isLead) ?? null;
  const eligibleMembers = sub.advisors.filter((a) => catalog.advisors.find((c) => c.id === a.advisorId)?.leadEligible);

  return (
    <div className="space-y-space-4">
      <div>
        <span className="eyebrow">Admin · Fast board</span>
        <h1>{sub.customer.companyName}</h1>
        <p className="mt-space-3 flex flex-wrap items-center gap-3 text-sm text-muted">
          <SubStatusBadge status={sub.status} />
          <span>{sub.advisorCount} rådgivere · {frequencyLabel(sub.frequencyWeeks)} · {formatDkk(sub.monthlyPriceDkk)} / md. ekskl. moms</span>
          <Link href="/admin/subscriptions">← Alle abonnementer</Link>
          <Link href={`/admin/customers/${sub.customerId}`}>Kunden</Link>
        </p>
      </div>
      <Flash ok={ok} err={err} />

      <section className="card" aria-labelledby="lead-h" data-testid="lead-panel">
        <span className="eyebrow">Ansvarlig rådgiver</span>
        <h2 id="lead-h" className="text-xl font-light">{lead ? lead.advisor.user.name : "Ingen ansvarlig rådgiver"}</h2>
        <span className="rule-gold mt-3" aria-hidden="true" />
        {!lead && editable && (
          <p role="alert" className="callout callout-error mt-space-3 text-sm" data-testid="no-lead-warning">
            {eligibleMembers.length
              ? "Boardet har ingen ansvarlig rådgiver. Vælg en herunder."
              : "Ingen i boardet kan være ansvarlig rådgiver. Tilføj en rådgiver med tagget «Lead-kvalificeret» i boardet herunder."}
          </p>
        )}
        <p className="mt-space-3 text-sm text-muted">
          Tildeles automatisk (den kvalificerede rådgiver med færrest ansvarsroller) og skiftes automatisk, hvis den ansvarlige forlader boardet eller mister tagget. Se fordelingen under <Link href="/admin/ansvarlige">Ansvarlige</Link>.
        </p>
        {editable && eligibleMembers.length > 0 && (
          <form action={setLeadAction} className="mt-space-3 flex flex-wrap items-end gap-3" data-confirm="Skift ansvarlig rådgiver? Kunden og de to rådgivere får besked.">
            <input type="hidden" name="subscriptionId" value={sub.id} />
            <div>
              <label className="label" htmlFor="lead-select">Vælg ansvarlig (kun kvalificerede i boardet)</label>
              <select id="lead-select" name="advisorId" className="input !w-auto" defaultValue={lead?.advisorId ?? eligibleMembers[0].advisorId}>
                {eligibleMembers.map((a) => (
                  <option key={a.advisorId} value={a.advisorId}>{a.advisor.user.name}</option>
                ))}
              </select>
            </div>
            <button className="btn-secondary" type="submit">Gem ansvarlig</button>
          </form>
        )}
      </section>

      {!editable ? (
        <p className="callout text-sm">Abonnementet er opsagt og kan ikke ændres.</p>
      ) : (
        <BoardBuilder
          advisors={catalog.advisors}
          tags={catalog.tags}
          needs={needs}
          action={adminChangeBoardAction}
          submitLabel="Gem board"
          backHref="/admin/subscriptions"
          initialAdvisorIds={sub.advisors.map((a) => a.advisorId)}
          initialWeeks={sub.frequencyWeeks}
          currentLeadId={lead?.advisorId ?? null}
          intro="Udskift, tilføj eller fjern rådgivere (2-4). Nye rådgivere får deres aktuelle pris, de der bliver, beholder deres fastfrosne pris."
        >
          <input type="hidden" name="subscriptionId" value={sub.id} />
          <fieldset className="mt-space-4 border border-grey-bg bg-white p-space-3 sm:p-space-4">
            <legend className="label !mb-0 px-1">Pris ved ændring</legend>
            <div className="mt-2 grid gap-3 text-sm">
              <label className="flex items-start gap-3">
                <input type="radio" name="pricePolicy" value="keep" defaultChecked className="mt-1 h-4 w-4" />
                <span><span className="font-semibold text-navy">Behold nuværende pris</span> ({formatDkk(sub.monthlyPriceDkk)} / md. ekskl. moms)<span className="block text-muted">Kunden betaler det samme, uanset de nye rådgiveres priser.</span></span>
              </label>
              <label className="flex items-start gap-3">
                <input type="radio" name="pricePolicy" value="recalc" className="mt-1 h-4 w-4" />
                <span><span className="font-semibold text-navy">Genberegn efter de nye rådgiveres priser</span><span className="block text-muted">Den nye månedspris ses i oversigten. Opdateres hos betalingsudbyderen og gælder fra næste betalingsperiode.</span></span>
              </label>
            </div>
          </fieldset>
          <fieldset className="mt-space-3 border border-grey-bg bg-white p-space-3 sm:p-space-4">
            <legend className="label !mb-0 px-1">Kommende møder ({sub.meetings.length})</legend>
            <label className="mt-2 flex items-start gap-3 text-sm">
              <input type="checkbox" name="updateUpcoming" className="mt-1 h-4 w-4" disabled={sub.meetings.length === 0} />
              <span>
                <span className="font-semibold text-navy">Opdatér også kommende møder</span>
                <span className="block text-muted">Udskifter rådgiveren i fremtidige bookede møder, hvis den nye rådgiver er ledig. Ellers står mødet uændret, og konflikten vises efter gem.</span>
              </span>
            </label>
            {sub.meetings.length > 0 && (
              <ul className="mt-3 divide-y divide-grey-bg text-sm">
                {sub.meetings.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="first-letter:uppercase">{formatDateTime(m.startsAt)}</span>
                    <span className="text-muted">{m.participants.filter((p) => p.user.role === "ADVISOR").map((p) => p.user.name).join(", ")}</span>
                    <Link href={`/admin/meetings/${m.id}`}>Åbn</Link>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          <p className="mt-space-3 text-xs text-muted">Kunden og de berørte rådgivere underrettes (udløser «Board ændret»). Alt skrives til audit-loggen.</p>
        </BoardBuilder>
      )}
    </div>
  );
}
