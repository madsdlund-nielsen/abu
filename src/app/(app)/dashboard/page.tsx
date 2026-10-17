import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { MeetingTable } from "@/components/meeting-list";
import { Empty, Initials, SubStatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getQuotaInfo } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { formatDkk, frequencyLabel } from "@/lib/pricing";
import { periodBounds } from "@/lib/quota";
import { getCustomerSubscription } from "@/lib/subscriptions";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Overblik" };

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  if (user.role === "ADMIN") redirect("/admin");
  const { ok, err } = await flashFrom(searchParams);

  const upcoming = await prisma.meeting.findMany({
    where: { participants: { some: { userId: user.id } }, status: "BOOKED", endsAt: { gt: new Date() } },
    include: { participants: { include: { user: true } }, subscription: { include: { customer: true } } },
    orderBy: { startsAt: "asc" },
    take: 5,
  });
  const rows = upcoming.map((m) => ({
    id: m.id,
    startsAt: m.startsAt,
    status: m.status,
    who:
      user.role === "CUSTOMER"
        ? m.participants.filter((p) => p.user.role === "ADVISOR").map((p) => p.user.name).join(", ")
        : m.subscription.customer.companyName,
  }));

  if (user.role === "ADVISOR") {
    const rules = await prisma.availabilityRule.count({ where: { advisorId: user.id } });
    return (
      <div className="space-y-6">
        <h1>Hej {user.name.split(" ")[0]}</h1>
        <Flash ok={ok} err={err} />
        {rules === 0 && (
          <div className="callout text-sm">
            Du har endnu ikke angivet tilgængelighed, så kunder kan ikke booke dig. <Link href="/availability">Angiv tilgængelighed</Link>
          </div>
        )}
        <section>
          <h2 className="mb-3">Kommende møder</h2>
          {rows.length ? <MeetingTable rows={rows} whoLabel="Kunde" /> : <Empty>Ingen kommende møder.</Empty>}
        </section>
      </div>
    );
  }

  const sub = await getCustomerSubscription(user.id);
  const quota = sub?.status === "ACTIVE" ? await getQuotaInfo(sub.id) : null;
  let periodText = "";
  if (sub?.startedAt && quota) {
    const b = periodBounds(sub.startedAt, quota.currentPeriod, sub.frequencyWeeks);
    periodText = `${formatDate(b.start)} – ${formatDate(new Date(b.end.getTime() - 1))}`;
  }

  return (
    <div className="space-y-6">
      <h1>Hej {user.name.split(" ")[0]}</h1>
      <Flash ok={ok} err={err} />
      {!sub || sub.status === "PENDING" ? (
        <div className="card">
          <h2>Kom i gang</h2>
          <p className="mt-2 text-sm text-muted">Du har endnu ikke et aktivt abonnement. Sammensæt dit board og start.</p>
          <Link href="/subscribe" className="btn mt-4">Vælg abonnement</Link>
        </div>
      ) : (
        <section className="card">
          <div className="flex items-center justify-between gap-3">
            <h2>Dit abonnement</h2>
            <SubStatusBadge status={sub.status} />
          </div>
          <p className="mt-2 text-sm text-muted">
            {sub.advisorCount} rådgivere · {frequencyLabel(sub.frequencyWeeks)} · {formatDkk(sub.monthlyPriceDkk)} / md.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {sub.advisors.map((a) => (
              <div key={a.advisorId} className="flex items-center gap-3 border border-grey-bg p-3">
                <Initials name={a.advisor.user.name} url={a.advisor.photoUrl} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.advisor.user.name}</p>
                  <p className="truncate text-xs text-muted">{a.advisor.title}</p>
                </div>
              </div>
            ))}
          </div>
          {sub.status === "ACTIVE" && quota && (
            <p className="mt-4 text-sm text-muted">
              Aktuel periode: {periodText}.{" "}
              {quota.openPeriods.includes(quota.currentPeriod) ? (
                <>Du har et møde til gode. <Link href="/book">Book nu</Link></>
              ) : (
                <>Mødet for denne periode er booket. <Link href="/book">Book næste periode</Link></>
              )}
            </p>
          )}
        </section>
      )}
      <section>
        <h2 className="mb-3">Kommende møder</h2>
        {rows.length ? <MeetingTable rows={rows} whoLabel="Rådgivere" /> : <Empty>Ingen kommende møder.</Empty>}
      </section>
    </div>
  );
}
