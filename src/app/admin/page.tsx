import type { Metadata } from "next";
import Link from "next/link";
import { processJobsAction } from "@/app/actions/admin";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { prisma } from "@/lib/db";
import { formatDkk } from "@/lib/pricing";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminHome({ searchParams }: { searchParams: SP }) {
  const { ok, err } = await flashFrom(searchParams);
  const [advisors, customers, active, upcoming, pendingJobs, failedJobs, deletions, mrr] = await Promise.all([
    prisma.advisorProfile.count(),
    prisma.customerProfile.count(),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.meeting.count({ where: { status: "BOOKED", startsAt: { gt: new Date() } } }),
    prisma.job.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }),
    prisma.job.count({ where: { status: "FAILED" } }),
    prisma.user.count({ where: { deletionRequestedAt: { not: null } } }),
    prisma.subscription.aggregate({ where: { status: "ACTIVE" }, _sum: { monthlyPriceDkk: true } }),
  ]);
  const stats: [string, string | number, string][] = [
    ["Rådgivere", advisors, "/admin/advisors"],
    ["Kunder", customers, "/admin/customers"],
    ["Aktive abonnementer", active, "/admin/subscriptions"],
    ["Kommende møder", upcoming, "/admin/meetings"],
    ["Månedlig omsætning", formatDkk(mrr._sum.monthlyPriceDkk ?? 0), "/admin/subscriptions"],
    ["Sletningsanmodninger", deletions, "/admin/customers"],
  ];
  return (
    <div className="space-y-6">
      <h1>Admin</h1>
      <Flash ok={ok} err={err} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map(([label, value, href]) => (
          <Link key={label} href={href} className="card block no-underline hover:bg-white">
            <p className="label !mb-0">{label}</p>
            <p className="mt-1 text-3xl font-light text-navy">{value}</p>
          </Link>
        ))}
      </div>
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
