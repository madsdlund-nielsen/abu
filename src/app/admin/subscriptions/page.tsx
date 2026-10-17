import type { Metadata } from "next";
import { setBoardAction } from "@/app/actions/admin";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { SubStatusBadge } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDkk, frequencyLabel } from "@/lib/pricing";

export const metadata: Metadata = { title: "Abonnementer" };

export default async function AdminSubscriptions({ searchParams }: { searchParams: SP }) {
  const { ok, err } = await flashFrom(searchParams);
  const [subs, advisors] = await Promise.all([
    prisma.subscription.findMany({
      include: { customer: true, advisors: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.advisorProfile.findMany({ include: { user: true }, orderBy: { user: { name: "asc" } } }),
  ]);
  return (
    <div className="space-y-6">
      <h1>Abonnementer</h1>
      <Flash ok={ok} err={err} />
      {subs.map((s) => {
        const selected = new Set(s.advisors.map((a) => a.advisorId));
        return (
          <section key={s.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2>{s.customer.companyName}</h2>
                <p className="text-sm text-slate-600">
                  {s.advisorCount} rådgivere · {frequencyLabel(s.frequencyWeeks)} · {formatDkk(s.monthlyPriceDkk)} / md. · {s.provider}
                </p>
              </div>
              <SubStatusBadge status={s.status} />
            </div>
            <form action={setBoardAction} className="mt-4">
              <input type="hidden" name="subscriptionId" value={s.id} />
              <p className="label">Board (vælg præcis {s.advisorCount})</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {advisors.map((a) => (
                  <label key={a.userId} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="advisorIds" value={a.userId} defaultChecked={selected.has(a.userId)} />
                    {a.user.name}{!a.active && <span className="text-slate-400"> (inaktiv)</span>}
                  </label>
                ))}
              </div>
              <button className="btn-secondary btn-sm mt-3" type="submit">Gem board</button>
            </form>
          </section>
        );
      })}
    </div>
  );
}
