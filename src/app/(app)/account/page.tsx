import type { Metadata } from "next";
import Link from "next/link";
import { cancelDeletionRequestAction, requestDeletionAction } from "@/app/actions/account";
import { changePasswordAction } from "@/app/actions/auth";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { MIN_PASSWORD_LENGTH, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Konto" };

export default async function AccountPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const { ok, err } = await flashFrom(searchParams);
  const customer = user.role === "CUSTOMER" ? await prisma.customerProfile.findUnique({ where: { userId: user.id } }) : null;
  return (
    <div className="space-y-6">
      <h1>Konto</h1>
      <Flash ok={ok} err={err} />

      <section className="card">
        <h2>Oplysninger</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Navn</dt><dd>{user.name}</dd></div>
          <div><dt className="text-muted">E-mail</dt><dd>{user.email}</dd></div>
          {user.phone && <div><dt className="text-muted">Telefon</dt><dd>{user.phone}</dd></div>}
          {customer && (
            <>
              <div><dt className="text-muted">Virksomhed</dt><dd>{customer.companyName}</dd></div>
              <div><dt className="text-muted">CVR</dt><dd>{customer.cvr}</dd></div>
            </>
          )}
        </dl>
        {user.role === "CUSTOMER" && (
          <p className="mt-4 text-sm"><Link href="/account/subscription">Administrer abonnement</Link></p>
        )}
      </section>

      <section className="card">
        <h2>Skift adgangskode</h2>
        <form action={changePasswordAction} className="mt-3 grid max-w-md gap-3">
          <div>
            <label className="label" htmlFor="current">Nuværende adgangskode</label>
            <input className="input" id="current" name="current" type="password" required autoComplete="current-password" />
          </div>
          <div>
            <label className="label" htmlFor="password">Ny adgangskode (mindst {MIN_PASSWORD_LENGTH} tegn)</label>
            <input className="input" id="password" name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
          </div>
          <div><button className="btn" type="submit">Gem</button></div>
        </form>
      </section>

      <section className="card">
        <h2>Dine data (GDPR)</h2>
        <p className="mt-2 text-sm text-muted">Download alle data, vi har om dig, som en JSON-fil.</p>
        <a className="btn-secondary mt-3" href="/api/account/export" download>Download mine data</a>

        {user.role !== "ADMIN" && (
          <div className="mt-6 border-t border-grey-bg pt-4">
            <h3>Slet min konto</h3>
            {user.deletionRequestedAt ? (
              <>
                <p className="mt-2 text-sm text-muted">
                  Du har anmodet om sletning den {formatDate(user.deletionRequestedAt)}. Vi behandler anmodningen.
                </p>
                <form action={cancelDeletionRequestAction} className="mt-3">
                  <button className="btn-secondary" type="submit">Træk anmodning tilbage</button>
                </form>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted">
                  Vi sletter din konto og alle tilhørende data (inkl. møder og transskriptioner). Et aktivt abonnement skal
                  opsiges først.
                </p>
                <form action={requestDeletionAction} className="mt-3">
                  <button className="btn-danger" type="submit">Anmod om sletning</button>
                </form>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
