import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { MeetingTable } from "@/components/meeting-list";
import { AdvisorAvatar } from "@/components/advisor-avatar";
import { Empty, SubStatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { visibleAvatarVersion } from "@/lib/avatar-url";
import { getQuotaInfo } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { formatDkk, frequencyLabel } from "@/lib/pricing";
import { periodBounds } from "@/lib/quota";
import { getCustomerSubscription } from "@/lib/subscriptions";
import { userDirectory } from "@/lib/user-directory";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Overblik" };

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  if (user.role === "ADMIN") redirect("/admin");
  const { ok, err } = await flashFrom(searchParams);

  const upcoming = await prisma.meeting.findMany({
    where: { participants: { some: { userId: user.id } }, status: "BOOKED", endsAt: { gt: new Date() } },
    include: { participants: true, subscription: { include: { customer: true, advisors: { where: { isLead: true }, select: { advisorId: true } } } } },
    orderBy: { startsAt: "asc" },
    take: 5,
  });
  // RLS: deltagernes navn og rolle fra kataloget (ikke deres User-rækker)
  const people = await userDirectory(upcoming.flatMap((m) => m.participants.map((p) => p.userId)));
  const rows = upcoming.map((m) => ({
    id: m.id,
    startsAt: m.startsAt,
    status: m.status,
    who:
      user.role === "CUSTOMER"
        ? m.participants.map((p) => people.get(p.userId)).filter((p) => p?.role === "ADVISOR").map((p) => p!.name).join(", ")
        : `${m.subscription.customer.companyName}${m.subscription.advisors.some((a) => a.advisorId === user.id) ? " · du er ansvarlig rådgiver" : ""}`,
  }));

  if (user.role === "ADVISOR") {
    const [rules, boards] = await Promise.all([
      prisma.availabilityRule.count({ where: { advisorId: user.id } }),
      prisma.subscriptionAdvisor.findMany({
        where: { advisorId: user.id, subscription: { status: { in: ["ACTIVE", "PAST_DUE"] } } },
        select: { isLead: true, subscription: { select: { id: true, frequencyWeeks: true, customer: { select: { companyName: true } } } } },
        orderBy: { isLead: "desc" },
      }),
    ]);
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
        <section className="card" data-testid="advisor-boards">
          <h2>Dine boards</h2>
          {boards.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Du sidder ikke i nogen aktive boards endnu.</p>
          ) : (
            <ul className="mt-3 divide-y divide-grey-bg text-sm">
              {boards.map((b) => (
                <li key={b.subscription.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium">{b.subscription.customer.companyName} <span className="text-muted">· {frequencyLabel(b.subscription.frequencyWeeks)}</span></span>
                  {b.isLead && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-navy" data-testid="you-are-lead">
                      <span aria-hidden="true" className="inline-block h-0.5 w-4 bg-gold" />
                      Du er ansvarlig rådgiver
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">Møderne holdes altid med hele boardet. Den ansvarlige rådgiver er kundens faste kontakt.</p>
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
                <AdvisorAvatar advisorId={a.advisorId} name={a.advisor.user.name} photo={visibleAvatarVersion({ id: a.advisorId, ...a.advisor }, user)} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.advisor.user.name}</p>
                  <p className="truncate text-xs text-muted">{a.advisor.title}</p>
                  {a.isLead && (
                    <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-navy" data-testid="lead-badge">
                      <span aria-hidden="true" className="inline-block h-0.5 w-4 bg-gold" />
                      Ansvarlig rådgiver
                    </p>
                  )}
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
