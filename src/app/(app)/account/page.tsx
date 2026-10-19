import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { cancelDeletionRequestAction, requestDeletionAction } from "@/app/actions/account";
import { revokeAllTrustedDevicesAction, revokeTrustedDeviceAction } from "@/app/actions/mfa";
import { ChangePasswordForm, NotificationPrefsForm } from "@/components/auth-forms";
import { DisableMfaForm, RegenerateCodesForm } from "@/components/mfa-forms";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { MIN_PASSWORD_LENGTH, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/time";
import { getTrustedDeviceDays, listTrustedDevices, remainingRecoveryCodes } from "@/lib/mfa/service";
import { RECOVERY_CODE_COUNT } from "@/lib/mfa/recovery";
import { DEVICE_COOKIE, trustedDeviceEndsAt } from "@/lib/mfa/trusted-device";
import { sha256 } from "@/lib/tokens";

export const metadata: Metadata = { title: "Konto" };

export default async function AccountPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const { ok, err } = await flashFrom(searchParams);
  const customer = user.role === "CUSTOMER" ? await prisma.customerProfile.findUnique({ where: { userId: user.id } }) : null;
  const marketing = await prisma.marketingConsent.findFirst({
    where: { userId: user.id, OR: [{ emailConsent: true, emailWithdrawnAt: null }, { smsConsent: true, smsWithdrawnAt: null }] },
    orderBy: { consentedAt: "desc" },
  });
  const [devices, days, remaining] = await Promise.all([listTrustedDevices(user.id), getTrustedDeviceDays(), user.mfaEnabledAt ? remainingRecoveryCodes(user.id) : 0]);
  const myDevice = (await cookies()).get(DEVICE_COOKIE)?.value;
  const myHash = myDevice ? sha256(myDevice) : null;
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

      <section className="card scroll-mt-24" id="totrin" aria-labelledby="totrin-h" data-testid="mfa-section">
        <h2 id="totrin-h">Totrinsbekræftelse</h2>
        {user.mfaEnabledAt ? (
          <>
            <p className="mt-2 text-sm">
              <span className="badge badge-navy">Slået til</span>{" "}
              <span className="text-muted">siden {formatDate(user.mfaEnabledAt)}. Ved login skal du bruge en kode fra din godkendelses-app.</span>
            </p>
            <p className="mt-2 text-sm" data-testid="recovery-remaining">
              <span className={remaining <= 2 ? "font-semibold text-danger" : "font-semibold text-navy"}>{remaining} af {RECOVERY_CODE_COUNT}</span>{" "}
              <span className="text-muted">gendannelseskoder tilbage.{remaining <= 2 && " Lav nye, før de slipper op."}</span>
            </p>
            <details className="mt-space-3">
              <summary className="cursor-pointer text-sm font-semibold text-navy">Lav nye gendannelseskoder</summary>
              <p className="mt-2 text-sm text-muted">De nuværende koder holder op med at virke. Kræver en aktuel kode fra appen.</p>
              <RegenerateCodesForm email={user.email} />
            </details>
            {user.role === "ADMIN" ? (
              <p className="mt-space-3 text-sm text-muted">Totrinsbekræftelse er påkrævet for administratorer og kan ikke slås fra. Mister du telefonen, kan en anden administrator nulstille den.</p>
            ) : (
              <details className="mt-space-3">
                <summary className="cursor-pointer text-sm font-semibold text-navy">Slå totrinsbekræftelse fra</summary>
                <DisableMfaForm />
              </details>
            )}
          </>
        ) : (
          <>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              Beskyt din konto med en kode fra en godkendelses-app (fx Authy, Google Authenticator eller 1Password) ud over adgangskoden.
              Det er valgfrit for rådgivere og kunder.
            </p>
            <Link href="/mfa/opsaet" className="btn-secondary mt-3">Slå totrinsbekræftelse til</Link>
          </>
        )}
      </section>

      {(user.mfaEnabledAt || devices.length > 0) && (
        <section className="card scroll-mt-24" id="enheder" aria-labelledby="enheder-h" data-testid="trusted-devices">
          <h2 id="enheder-h">Betroede enheder</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            {days > 0
              ? `Når du vælger «Husk denne enhed», springes koden over ved login fra enheden i op til ${days} dage fra den dag, du valgte det – også selv om du bruger den. Adgangskoden kræves altid.`
              : "«Husk denne enhed» er slået fra af administratoren. Koden kræves ved hvert login."}
          </p>
          {devices.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Ingen betroede enheder.</p>
          ) : (
            <>
              <div className="table-wrap mt-3">
                <table className="table">
                  <thead>
                    <tr><th>Enhed</th><th>Omtrentlig IP</th><th>Tilføjet</th><th>Kode kræves igen</th><th>Senest brugt</th><th /></tr>
                  </thead>
                  <tbody>
                    {devices.map((d) => (
                      <tr key={d.id} data-testid="trusted-device">
                        <td>
                          {d.label}
                          {d.tokenHash === myHash && <span className="badge badge-gold ml-2">Denne enhed</span>}
                        </td>
                        <td className="font-mono text-xs">{d.ipPrefix ?? "ukendt"}</td>
                        <td>{formatDate(d.createdAt)}</td>
                        <td>{formatDate(trustedDeviceEndsAt(d, days))}</td>
                        <td>{d.lastUsedAt ? formatDateTime(d.lastUsedAt) : "–"}</td>
                        <td className="text-right">
                          <form action={revokeTrustedDeviceAction} data-confirm={`Fjern «${d.label}»? Koden kræves igen ved næste login fra enheden.`}>
                            <input type="hidden" name="deviceId" value={d.id} />
                            <button className="btn-secondary btn-sm" type="submit">Fjern</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <form action={revokeAllTrustedDevicesAction} className="mt-3" data-confirm="Fjern alle betroede enheder? Koden kræves igen ved næste login overalt.">
                <button className="btn-secondary btn-sm" type="submit">Fjern alle</button>
              </form>
            </>
          )}
        </section>
      )}

      {user.role === "ADMIN" && (
        <section className="card" aria-labelledby="admins-h">
          <h2 id="admins-h">Administratorer</h2>
          <p className="mt-2 text-sm text-muted">Invitér, deaktivér og nulstil totrinsbekræftelse for platform-administratorer.</p>
          <Link href="/admin/administratorer" className="btn-secondary mt-3">Administrér administratorer</Link>
        </section>
      )}

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
