import type { Metadata } from "next";
import Link from "next/link";
import { deactivateAdminAction, resetAdminMfaAction, revokeAdminDevicesAction, saveTrustedDeviceDaysAction } from "@/app/actions/admin-users";
import { AdminInviteForm, ResendAdminInviteButton } from "@/components/admin/admin-invite";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { listAdmins, type AdminRow } from "@/lib/admin-users";
import { isMfaFresh, MFA_REVERIFY_WINDOW_MS, requireSession } from "@/lib/auth";
import { getTrustedDeviceDays } from "@/lib/mfa/service";
import { TRUSTED_DEVICE_DAYS_MAX } from "@/lib/mfa/trusted-device";
import { formatDate, formatDateTime, formatTime } from "@/lib/time";

export const metadata: Metadata = { title: "Administratorer" };
export const dynamic = "force-dynamic";

const STATUS: Record<AdminRow["status"], [string, string]> = {
  active: ["Aktiv", "badge-navy"],
  invited: ["Inviteret", "badge-gold"],
  deactivated: ["Deaktiveret", "badge-muted"],
};

const REVERIFY = `/mfa/bekraeft?next=${encodeURIComponent("/admin/administratorer")}`;

/** Platform-administratorer: liste, invitation, ny invitation, deaktivering, nulstilling af MFA og betroede enheder. */
export default async function AdminsPage({ searchParams }: { searchParams: SP }) {
  const { user: me, session } = await requireSession();
  const { ok, err } = await flashFrom(searchParams);
  const [admins, days] = await Promise.all([listAdmins(), getTrustedDeviceDays()]);
  const fresh = isMfaFresh(session);
  const activeCount = admins.filter((a) => a.status === "active").length;
  return (
    <div className="space-y-6">
      <div>
        <span className="eyebrow">Platform</span>
        <h1>Administratorer</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Administratorer har adgang til alt i ABU. Alle skal bruge totrinsbekræftelse (kode fra en godkendelses-app), som opsættes ved første login.
        </p>
      </div>
      <Flash ok={ok} err={err} />

      {fresh && session.mfaVerifiedAt ? (
        <p className="callout text-sm" data-testid="reverify-status">
          Du har bekræftet med kode kl. {formatTime(session.mfaVerifiedAt)}. Handlingerne her er åbne til kl.{" "}
          {formatTime(new Date(session.mfaVerifiedAt.getTime() + MFA_REVERIFY_WINDOW_MS))}.
        </p>
      ) : (
        <div className="callout flex flex-wrap items-center justify-between gap-3 text-sm" data-testid="reverify-status">
          <p>Handlingerne på denne side er følsomme og kræver, at du har bekræftet med en kode inden for de seneste 15 minutter.</p>
          <Link href={REVERIFY} className="btn btn-sm">Bekræft med kode</Link>
        </div>
      )}

      {activeCount <= 1 && (
        <p className="callout callout-error text-sm" data-testid="last-admin">
          Du er den eneste aktive administrator, og den sidste aktive administrator kan ikke deaktiveres. Invitér gerne en mere, så I ikke låser jer ude,
          hvis du mister både telefon og gendannelseskoder (nødprocedure: <code className="font-mono">npm run create-admin -- --reset-mfa</code> på serveren).
        </p>
      )}

      <div className="table-wrap">
        <table className="table" data-testid="admins-table">
          <thead>
            <tr><th>Navn</th><th>Status</th><th>Totrinsbekræftelse</th><th>Seneste login</th><th>Betroede enheder</th><th /></tr>
          </thead>
          <tbody>
            {admins.map((a) => {
              const [label, cls] = STATUS[a.status];
              const self = a.id === me.id;
              const lastActive = a.status === "active" && activeCount <= 1;
              return (
                <tr key={a.id} data-testid="admin-row" data-email={a.email}>
                  <td>
                    <p className="font-medium">{a.name}{self && <span className="ml-2 text-xs text-muted">(dig)</span>}</p>
                    <p className="text-xs text-muted">{a.email}</p>
                  </td>
                  <td>
                    <span className={`badge ${cls}`}>{label}</span>
                    {a.deactivatedAt && <p className="mt-1 text-xs text-muted">{formatDate(a.deactivatedAt)}</p>}
                  </td>
                  <td>
                    {a.mfaEnabledAt ? (
                      <span className="text-sm"><span className="font-semibold text-navy">Slået til</span> <span className="text-xs text-muted">{formatDate(a.mfaEnabledAt)}</span></span>
                    ) : (
                      <span className="text-sm text-gold-ink">Ikke opsat endnu</span>
                    )}
                  </td>
                  <td className="text-sm">{a.lastLoginAt ? formatDateTime(a.lastLoginAt) : <span className="text-muted">Aldrig</span>}</td>
                  <td className="text-sm tabular-nums">{a.trustedDevices}</td>
                  <td>
                    <div className="flex flex-wrap items-start justify-end gap-2">
                      {a.status === "invited" && <ResendAdminInviteButton userId={a.id} disabled={!fresh} />}
                      {!self && a.mfaEnabledAt && a.status !== "deactivated" && (
                        <form action={resetAdminMfaAction} data-confirm={`Nulstil totrinsbekræftelsen for ${a.name}? Vedkommende logges ud og skal opsætte den igen ved næste login.`}>
                          <input type="hidden" name="userId" value={a.id} />
                          <button className="btn-secondary btn-sm" type="submit" disabled={!fresh}>Nulstil MFA</button>
                        </form>
                      )}
                      {a.trustedDevices > 0 && (
                        <form action={revokeAdminDevicesAction} data-confirm={`Fjern alle betroede enheder for ${a.name}? Koden kræves igen ved næste login.`}>
                          <input type="hidden" name="userId" value={a.id} />
                          <button className="btn-secondary btn-sm" type="submit" disabled={!fresh}>Fjern enheder</button>
                        </form>
                      )}
                      {!self && a.status !== "deactivated" && (
                        <form action={deactivateAdminAction} data-confirm={`Deaktivér ${a.name}? Vedkommende logges ud overalt og kan ikke logge ind igen.`}>
                          <input type="hidden" name="userId" value={a.id} />
                          <button className="btn-danger btn-sm" type="submit" disabled={!fresh || lastActive} title={lastActive ? "Den sidste aktive administrator kan ikke deaktiveres" : undefined}>Deaktivér</button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Du kan ikke deaktivere dig selv, og den sidste aktive administrator kan ikke deaktiveres. En deaktiveret administrator genaktiveres ved at invitere e-mailen igen.</p>

      <section className="card" aria-labelledby="invite-h">
        <h2 id="invite-h">Invitér administrator</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Der oprettes en administrator uden adgangskode, og der sendes en invitation med et link (7 dage) til at vælge adgangskode. Ved første login skal
          vedkommende opsætte totrinsbekræftelse. Teksten redigeres under Notifikationer (udløseren «Administrator inviteret»).
        </p>
        <AdminInviteForm disabled={!fresh} />
      </section>

      <section className="card" aria-labelledby="devices-h">
        <h2 id="devices-h">«Husk denne enhed»</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Hvor mange dage en betroet enhed må springe koden over ved login (adgangskoden kræves altid). Varigheden regnes fra den dag, enheden blev husket,
          og forlænges ikke ved brug. Højst {TRUSTED_DEVICE_DAYS_MAX} dage; 0 slår funktionen fra. Gælder alle brugere med totrinsbekræftelse.
        </p>
        <form action={saveTrustedDeviceDaysAction} className="mt-space-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="days">Dage</label>
            <input className="input !w-28" id="days" name="days" inputMode="numeric" pattern="[0-9]{1,2}" defaultValue={days} required disabled={!fresh} />
          </div>
          <button className="btn-secondary" type="submit" disabled={!fresh}>Gem</button>
        </form>
      </section>
    </div>
  );
}
