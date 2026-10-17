import type { Metadata } from "next";
import Link from "next/link";
import { resendInviteAction, toggleAdvisorActiveAction } from "@/app/actions/admin";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Rådgivere" };

export default async function AdminAdvisors({ searchParams }: { searchParams: SP }) {
  const { ok, err, one, params } = await flashFrom(searchParams);
  const invite = one(params.invite);
  const advisors = await prisma.advisorProfile.findMany({ include: { user: true }, orderBy: { user: { name: "asc" } } });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1>Rådgivere</h1>
        <Link href="/admin/advisors/new" className="btn">Opret rådgiver</Link>
      </div>
      <Flash ok={ok} err={err} />
      {invite && (
        <div className="callout text-sm">
          <p className="font-medium">Invitationslink (vises kun fordi e-mail kører i konsol-tilstand eller ikke kunne sendes):</p>
          <p className="mt-2 break-all bg-grey-bg p-2 font-mono text-xs" data-testid="invite-link">{invite}</p>
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Navn</th><th>Titel</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {advisors.map((a) => (
              <tr key={a.userId}>
                <td>
                  <p className="font-medium">{a.user.name}</p>
                  <p className="text-xs text-muted">{a.user.email}</p>
                </td>
                <td>{a.title}</td>
                <td>
                  <span className={`badge ${a.active ? "badge-navy" : "badge-muted"}`}>
                    {a.active ? "Aktiv" : "Inaktiv"}
                  </span>
                  {!a.user.passwordHash && <span className="badge badge-gold ml-1">Ikke accepteret</span>}
                </td>
                <td>
                  <div className="flex justify-end gap-2">
                    {!a.user.passwordHash && (
                      <form action={resendInviteAction}>
                        <input type="hidden" name="userId" value={a.userId} />
                        <button className="btn-secondary btn-sm" type="submit">Ny invitation</button>
                      </form>
                    )}
                    <form action={toggleAdvisorActiveAction}>
                      <input type="hidden" name="userId" value={a.userId} />
                      <button className="btn-secondary btn-sm" type="submit">{a.active ? "Deaktiver" : "Aktiver"}</button>
                    </form>
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
