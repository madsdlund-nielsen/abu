import type { Metadata } from "next";
import Link from "next/link";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { AdvisorAvatar } from "@/components/advisor-avatar";
import { SubStatusBadge } from "@/components/ui";
import { avatarVersion } from "@/lib/avatar-url";
import { prisma } from "@/lib/db";
import { formatDkk, frequencyLabel } from "@/lib/pricing";

export const metadata: Metadata = { title: "Abonnementer" };

export default async function AdminSubscriptions({ searchParams }: { searchParams: SP }) {
  const { ok, err } = await flashFrom(searchParams);
  const subs = await prisma.subscription.findMany({
    include: { customer: true, advisors: { include: { advisor: { include: { user: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="space-y-space-4">
      <div>
        <span className="eyebrow">Admin · Abonnementer</span>
        <h1>Abonnementer</h1>
      </div>
      <Flash ok={ok} err={err} />
      <ul className="grid gap-space-3">
        {subs.map((s) => (
          <li key={s.id} className="card" data-testid="subscription-row" data-company={s.customer.companyName}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl">{s.customer.companyName}</h2>
                <p className="text-sm text-muted">
                  {s.advisorCount} rådgivere · {frequencyLabel(s.frequencyWeeks)} · {formatDkk(s.monthlyPriceDkk)} / md. ekskl. moms · {s.provider}
                </p>
              </div>
              <SubStatusBadge status={s.status} />
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Board">
              {s.advisors.map((a) => (
                <li key={a.advisorId} className="flex items-center gap-2"><AdvisorAvatar advisorId={a.advisorId} name={a.advisor.user.name} photo={a.advisor.photoKey ? avatarVersion(a.advisor.photoUpdatedAt) : null} size="sm" />{a.advisor.user.name}{a.isLead && <span className="badge badge-gold" data-testid="lead-badge">Ansvarlig</span>}</li>
              ))}
            </ul>
            {s.status !== "CANCELLED" && !s.advisors.some((a) => a.isLead) && <p className="mt-2 text-sm font-semibold text-danger">Ingen ansvarlig rådgiver</p>}
            <div className="mt-4">
              <Link className="btn-secondary btn-sm" href={`/admin/subscriptions/${s.id}`}>Rediger board</Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
