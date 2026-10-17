import type { Metadata } from "next";
import Link from "next/link";
import { processDeletionAction } from "@/app/actions/admin";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { SubStatusBadge } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Kunder" };

export default async function AdminCustomers({ searchParams }: { searchParams: SP }) {
  const { ok, err, one, params } = await flashFrom(searchParams);
  const onlyUnverified = one(params.filter) === "ikke-verificeret";
  const customers = await prisma.customerProfile.findMany({
    where: onlyUnverified ? { cvrVerified: false } : undefined,
    include: { user: true, subscriptions: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { user: { createdAt: "desc" } },
  });
  return (
    <div className="space-y-6">
      <h1>Kunder</h1>
      <Flash ok={ok} err={err} />
      <nav aria-label="Filtrér kunder" className="flex flex-wrap gap-2 text-sm">
        <Link href="/admin/customers" aria-current={!onlyUnverified ? "true" : undefined} className={`badge no-underline ${!onlyUnverified ? "badge-navy" : "badge-muted"}`}>Alle</Link>
        <Link href="/admin/customers?filter=ikke-verificeret" aria-current={onlyUnverified ? "true" : undefined} className={`badge no-underline ${onlyUnverified ? "badge-navy" : "badge-muted"}`}>Ikke verificeret (manuelt indtastet)</Link>
      </nav>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Virksomhed</th><th>Kontakt</th><th>Oprettet</th><th>Abonnement</th><th /></tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.userId}>
                <td><Link href={`/admin/customers/${c.userId}`} className="font-medium">{c.companyName}</Link><p className="text-xs text-muted">CVR {c.cvr}{!c.cvrVerified && <span className="badge badge-gold ml-2">Ikke verificeret</span>}</p></td>
                <td><p>{c.user.name}</p><p className="text-xs text-muted">{c.user.email} · {c.user.phone}</p></td>
                <td>{formatDate(c.user.createdAt)}</td>
                <td>{c.subscriptions[0] ? <SubStatusBadge status={c.subscriptions[0].status} /> : <span className="text-muted">Ingen</span>}</td>
                <td className="text-right">
                  {c.user.deletionRequestedAt && (
                    <form action={processDeletionAction} data-confirm="Slet brugeren og alle tilhørende data permanent? Det kan ikke fortrydes.">
                      <input type="hidden" name="userId" value={c.userId} />
                      <button className="btn-danger btn-sm" type="submit">
                        Slet (anmodet {formatDate(c.user.deletionRequestedAt)})
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
