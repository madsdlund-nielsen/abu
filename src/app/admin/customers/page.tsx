import type { Metadata } from "next";
import Link from "next/link";
import { processDeletionAction } from "@/app/actions/admin";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { SubStatusBadge } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Kunder" };

export default async function AdminCustomers({ searchParams }: { searchParams: SP }) {
  const { ok, err } = await flashFrom(searchParams);
  const customers = await prisma.customerProfile.findMany({
    include: { user: true, subscriptions: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { user: { createdAt: "desc" } },
  });
  return (
    <div className="space-y-6">
      <h1>Kunder</h1>
      <Flash ok={ok} err={err} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Virksomhed</th><th>Kontakt</th><th>Oprettet</th><th>Abonnement</th><th /></tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.userId}>
                <td><Link href={`/admin/customers/${c.userId}`} className="font-medium">{c.companyName}</Link><p className="text-xs text-muted">CVR {c.cvr}{!c.cvrVerified && " · ikke verificeret"}</p></td>
                <td><p>{c.user.name}</p><p className="text-xs text-muted">{c.user.email} · {c.user.phone}</p></td>
                <td>{formatDate(c.user.createdAt)}</td>
                <td>{c.subscriptions[0] ? <SubStatusBadge status={c.subscriptions[0].status} /> : <span className="text-muted">Ingen</span>}</td>
                <td className="text-right">
                  {c.user.deletionRequestedAt && (
                    <form action={processDeletionAction}>
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
