import type { Metadata } from "next";
import Link from "next/link";
import { processJobsAction } from "@/app/actions/admin";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { ALERT_LABEL, recentAlerts } from "@/lib/alerts";
import { ACTIVE_ADMIN_WHERE } from "@/lib/admin-users";
import { prisma } from "@/lib/db";
import { loadLeadOverview } from "@/lib/lead";
import { meetingsBelowBoard } from "@/lib/meeting-admin";
import { formatDateTime } from "@/lib/time";
import { formatDkk } from "@/lib/pricing";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminHome({ searchParams }: { searchParams: SP }) {
  const { ok, err } = await flashFrom(searchParams);
  const [advisors, customers, active, upcoming, pendingJobs, failedJobs, deletions, mrr, alerts, belowBoard, leadOverview, admins] = await Promise.all([
    prisma.advisorProfile.count(),
    prisma.customerProfile.count(),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.meeting.count({ where: { status: "BOOKED", startsAt: { gt: new Date() } } }),
    prisma.job.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }),
    prisma.job.count({ where: { status: "FAILED" } }),
    prisma.user.count({ where: { deletionRequestedAt: { not: null } } }),
    prisma.subscription.aggregate({ where: { status: "ACTIVE" }, _sum: { monthlyPriceDkk: true } }),
    recentAlerts(7),
    meetingsBelowBoard(),
    loadLeadOverview(),
    prisma.user.count({ where: ACTIVE_ADMIN_WHERE }),
  ]);
  const stats: [string, string | number, string][] = [
    ["Rådgivere", advisors, "/admin/advisors"],
    ["Kunder", customers, "/admin/customers"],
    ["Aktive abonnementer", active, "/admin/subscriptions"],
    ["Kommende møder", upcoming, "/admin/meetings"],
    ["Månedlig omsætning", formatDkk(mrr._sum.monthlyPriceDkk ?? 0), "/admin/subscriptions"],
    ["Sletningsanmodninger", deletions, "/admin/customers"],
    ["Administratorer", admins, "/admin/administratorer"],
  ];
  return (
    <div className="space-y-6">
      <h1>Admin</h1>
      <Flash ok={ok} err={err} />
      {alerts.length > 0 && (
        <section className="card" aria-labelledby="alerts-h" data-testid="alerts">
          <h2 id="alerts-h">Driftsalarmer (seneste 7 dage)</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {alerts.map((a) => (
              <li key={a.kind} className="callout callout-error">
                <p className="font-semibold">{ALERT_LABEL[a.kind] ?? a.kind} · {a.count} gang{a.count === 1 ? "" : "e"}, senest {formatDateTime(new Date(a.lastAt))}</p>
                <p className="text-ink">{a.message}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Lofter og lande for SMS ændres under <Link href="/admin/notifikationer?fane=indstillinger">Notifikationer → Indstillinger</Link>.</p>
        </section>
      )}
      {belowBoard.length > 0 && (
        <section className="card" aria-labelledby="below-h" data-testid="meetings-below-board">
          <h2 id="below-h">Møder uden hele boardet</h2>
          <p className="mt-2 text-sm text-muted">Møder holdes altid med hele boardet. Disse kommende møder mangler en rådgiver – udskift eller tilføj en rådgiver på mødet.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {belowBoard.map((m) => (
              <li key={m.id} className="callout callout-error">
                <Link href={`/admin/meetings/${m.id}`} className="font-semibold">{m.companyName} · {formatDateTime(m.startsAt)}</Link>
                <span className="text-ink"> – {m.advisors} af {m.boardSize} rådgivere</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {leadOverview.withoutLead.length > 0 && (
        <section className="card" aria-labelledby="nolead-h" data-testid="boards-without-lead">
          <h2 id="nolead-h">Boards uden ansvarlig rådgiver</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {leadOverview.withoutLead.map((b) => (
              <li key={b.subscriptionId} className="callout callout-error">
                <Link href={`/admin/subscriptions/${b.subscriptionId}`} className="font-semibold">{b.label}</Link>
                <span className="text-ink"> – {b.hasEligible ? "vælg en ansvarlig rådgiver" : "ingen i boardet kan være ansvarlig; tilføj en rådgiver med lead-tagget"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Se fordelingen under <Link href="/admin/ansvarlige">Ansvarlige rådgivere</Link>.</p>
        </section>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map(([label, value, href]) => (
          <Link key={label} href={href} className="card block no-underline hover:bg-white">
            <p className="label !mb-0">{label}</p>
            <p className="mt-1 text-3xl font-light text-navy">{value}</p>
          </Link>
        ))}
      </div>
      <section className="card">
        <h2>Booking</h2>
        <p className="mt-2 text-sm text-muted">Danske helligdage spærres automatisk for booking. <Link href="/admin/helligdage">Se og ret helligdage og lukkedage</Link>.</p>
      </section>
      <section className="card">
        <h2>Baggrundsjobs</h2>
        <p className="mt-2 text-sm text-muted">{pendingJobs} afventer, {failedJobs} fejlet.</p>
        <form action={processJobsAction} className="mt-3">
          <button className="btn-secondary" type="submit">Kør ventende jobs nu</button>
        </form>
      </section>
    </div>
  );
}
