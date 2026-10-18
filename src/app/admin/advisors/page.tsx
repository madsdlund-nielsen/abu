import type { Metadata } from "next";
import Link from "next/link";
import { savePriceBoundsAction } from "@/app/actions/admin";
import { AdvisorActivationControl } from "@/components/admin/advisor-activation";
import { getPriceBounds } from "@/lib/advisor-price";
import { ResendInviteButton } from "@/components/admin/advisor-invite";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { AdvisorStatusBadge, ReadinessSummary } from "@/components/admin/readiness";
import { loadReadiness, missingReadiness } from "@/lib/advisor-readiness";
import { prisma } from "@/lib/db";
import { formatDkk } from "@/lib/pricing";

export const metadata: Metadata = { title: "Rådgivere" };

export default async function AdminAdvisors({ searchParams }: { searchParams: SP }) {
  const { ok, err } = await flashFrom(searchParams);
  const advisors = await prisma.advisorProfile.findMany({ include: { user: true, tags: { include: { tag: true } } }, orderBy: { user: { name: "asc" } } });
  const bounds = await getPriceBounds();
  const [readiness, boardRows] = await Promise.all([
    loadReadiness(advisors.map((a) => a.userId), bounds),
    prisma.subscriptionAdvisor.findMany({
      where: { advisorId: { in: advisors.map((a) => a.userId) }, subscription: { status: { in: ["ACTIVE", "PAST_DUE", "PENDING"] } } },
      select: { advisorId: true, subscription: { select: { customer: { select: { companyName: true } } } } },
    }),
  ]);
  const boardsOf = (id: string) => [...new Set(boardRows.filter((b) => b.advisorId === id).map((b) => b.subscription.customer.companyName))].sort((a, b) => a.localeCompare(b, "da"));
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1>Rådgivere</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/ansvarlige" className="btn-secondary">Ansvarlige rådgivere</Link>
          <Link href="/admin/advisors/new" className="btn">Opret rådgiver</Link>
        </div>
      </div>
      <Flash ok={ok} err={err} />
      <details className="card" data-testid="price-bounds">
        <summary className="text-sm">
          <span className="font-semibold text-navy">Tilladt pris pr. møde:</span> {formatDkk(bounds.min)} – {formatDkk(bounds.max)} <span className="text-muted">(ret)</span>
        </summary>
        <form action={savePriceBoundsAction} className="mt-space-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="pb-min">Mindst (kr.)</label>
            <input className="input !w-36" id="pb-min" name="min" inputMode="numeric" defaultValue={bounds.min} required />
          </div>
          <div>
            <label className="label" htmlFor="pb-max">Højst (kr.)</label>
            <input className="input !w-36" id="pb-max" name="max" inputMode="numeric" defaultValue={bounds.max} required />
          </div>
          <button className="btn-secondary" type="submit">Gem interval</button>
          <p className="w-full text-xs text-muted">Beskytter mod fejlindtastninger (fx 0 kr.) og dermed abonnementer på 0 kr. hos betalingsudbyderen.</p>
        </form>
      </details>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Navn</th><th>Titel</th><th>Tags</th><th className="text-right">Pris pr. møde</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {advisors.map((a) => (
              <tr key={a.userId}>
                <td>
                  <p className="font-medium">{a.user.name}</p>
                  <p className="text-xs text-muted">{a.user.email}</p>
                </td>
                <td>{a.title}</td>
                <td className="max-w-[18rem]">
                  <ul className="flex flex-wrap gap-1">
                    {a.tags.filter((t) => t.tag.kind === "COMPETENCE").map((t) => (
                      <li key={t.tagId} className={`badge ${t.tag.active ? "badge-muted" : "badge-outline opacity-60"}`}>{t.tag.name}</li>
                    ))}
                    {!a.tags.some((t) => t.tag.kind === "COMPETENCE") && <li className="text-xs text-gold-ink">Ingen kompetence-tags</li>}
                    {a.tags.filter((t) => t.tag.kind === "ADMIN").map((t) => (
                      <li key={t.tagId} className="badge badge-gold" title="Internt tag (kun admin)" data-testid="internal-tag"><span className="sr-only">Internt tag: </span>{t.tag.name}</li>
                    ))}
                  </ul>
                </td>
                <td className="text-right tabular-nums">{formatDkk(a.pricePerMeetingDkk)}</td>
                <td className="min-w-[13rem] max-w-[18rem]">
                  <AdvisorStatusBadge active={a.active} missing={missingReadiness(readiness.get(a.userId) ?? [])} />
                  <ReadinessSummary items={readiness.get(a.userId) ?? []} />
                  {a.active && boardsOf(a.userId).length > 0 && (
                    <p className="mt-1 text-xs text-muted">I boards hos {boardsOf(a.userId).join(", ")}</p>
                  )}
                </td>
                <td>
                  <div className="flex flex-wrap items-start justify-end gap-2">
                    <Link href={`/admin/advisors/${a.userId}`} className="btn-secondary btn-sm">Rediger</Link>
                    {!a.user.passwordHash && <ResendInviteButton userId={a.userId} />}
                    <AdvisorActivationControl
                      compact
                      userId={a.userId}
                      name={a.user.name}
                      active={a.active}
                      missing={missingReadiness(readiness.get(a.userId) ?? [])}
                      boards={boardsOf(a.userId)}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
