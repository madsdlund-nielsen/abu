import type { Metadata } from "next";
import Link from "next/link";
import { cancelDeletionRequestAction, requestDeletionAction } from "@/app/actions/account";
import { ChangePasswordForm, NotificationPrefsForm } from "@/components/auth-forms";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { MIN_PASSWORD_LENGTH, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Konto" };

export default async function AccountPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const { ok, err } = await flashFrom(searchParams);
  const customer = user.role === "CUSTOMER" ? await prisma.customerProfile.findUnique({ where: { userId: user.id } }) : null;
  const marketing = await prisma.marketingConsent.findFirst({
    where: { userId: user.id, OR: [{ emailConsent: true, emailWithdrawnAt: null }, { smsConsent: true, smsWithdrawnAt: null }] },
    orderBy: { consentedAt: "desc" },
  });
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
        <h2>Beskeder</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Vi sender påmindelser og beskeder om dine møder og dit abonnement. Her kan du slå e-mail eller SMS fra. Beskeder om konto og
          adgangskode sendes altid.
        </p>
        <NotificationPrefsForm
          email={!user.emailOptOutAt}
          sms={!user.smsOptOutAt}
          hasPhone={Boolean(user.phone)}
          marketing={marketing ? `Samtykke givet ${formatDate(marketing.consentedAt)}.` : null}
        />
        <p className="mt-4 border-t border-grey-bg pt-3 text-sm text-muted">
          Samtykke til optagelse og transskription af møder:{" "}
          {user.recordingConsentAt ? (
            <span className="font-semibold text-navy">givet {formatDate(user.recordingConsentAt)}</span>
          ) : (
            <span className="font-semibold text-danger">ikke givet – <Link href="/samtykke">giv samtykke</Link></span>
          )}
        </p>
      </section>

      <section className="card">
        <h2>Skift adgangskode</h2>
        <ChangePasswordForm minLength={MIN_PASSWORD_LENGTH} />
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
                <form action={requestDeletionAction} className="mt-3" data-confirm="Vil du anmode om sletning af din konto og alle tilhørende data?">
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
