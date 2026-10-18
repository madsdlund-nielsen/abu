import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { Band } from "@/components/band";
import { flashFrom, type SP } from "@/components/flash";
import { MfaSetupForm } from "@/components/mfa-forms";
import { QrCode } from "@/components/qr-code";
import { PageShell } from "@/components/site-header";
import { getSessionContext } from "@/lib/auth";
import { safeNextPath } from "@/lib/consent";
import { getOrStartEnrollment } from "@/lib/mfa/service";
import { groupSecret, otpauthUri, TOTP_ISSUER } from "@/lib/mfa/totp";

export const metadata: Metadata = { title: "Opsæt totrinsbekræftelse" };
export const dynamic = "force-dynamic";

/**
 * Opsætning af totrinsbekræftelse (TOTP). Påkrævet for administratorer (en session uden MFA kan kun nå denne side og
 * log ud), valgfri for rådgivere og kunder (fra Konto). QR-koden tegnes lokalt som SVG; hemmeligheden vises også som
 * tekst til manuel indtastning. Først en gyldig kode slår MFA til.
 */
export default async function MfaSetupPage({ searchParams }: { searchParams: SP }) {
  const ctx = await getSessionContext();
  const { one, params } = await flashFrom(searchParams);
  const next = safeNextPath(one(params.next));
  if (!ctx) redirect("/login");
  if (ctx.stage === "mfa_verify") redirect("/mfa");
  if (ctx.user.mfaEnabledAt) redirect("/account#totrin");
  const forced = ctx.stage === "mfa_setup";
  const secret = await getOrStartEnrollment(ctx.user);
  const uri = otpauthUri(secret, ctx.user.email);
  return (
    <PageShell variant="bare">
      <Band tone="grey">
        <div className="mx-auto max-w-3xl">
          <span className="eyebrow">{forced ? "Påkrævet for administratorer" : "Ekstra sikkerhed"}</span>
          <h1>Opsæt totrinsbekræftelse</h1>
          {forced && (
            <p className="callout mt-space-4 text-sm" data-testid="mfa-required">
              Administratorer skal bruge totrinsbekræftelse. Opsæt den nu for at fortsætte – det tager et par minutter.
            </p>
          )}
          <div className="panel mt-space-5 space-y-space-5">
            <section aria-labelledby="s1">
              <h2 id="s1" className="text-xl">1. Hent en godkendelses-app</h2>
              <p className="mt-2 text-sm text-muted">Fx Authy, Google Authenticator, Microsoft Authenticator eller 1Password på din telefon.</p>
            </section>
            <section aria-labelledby="s2">
              <h2 id="s2" className="text-xl">2. Scan QR-koden</h2>
              <div className="mt-space-3 grid gap-space-4 sm:grid-cols-[auto_1fr] sm:items-start">
                <div className="border border-grey-bg p-2">
                  <QrCode text={uri} label={`QR-kode til ${TOTP_ISSUER} for ${ctx.user.email}`} />
                </div>
                <div className="text-sm">
                  <p className="text-muted">Kan du ikke scanne? Vælg «Indtast nøgle» i appen, og skriv:</p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <dt className="text-muted">Konto</dt>
                    <dd>{TOTP_ISSUER} ({ctx.user.email})</dd>
                    <dt className="text-muted">Nøgle</dt>
                    <dd>
                      <code className="inline-block bg-grey-bg px-2 py-1 font-mono text-sm text-ink sm:whitespace-nowrap" data-testid="mfa-secret">{groupSecret(secret)}</code>
                    </dd>
                    <dt className="text-muted">Type</dt>
                    <dd>Tidsbaseret (TOTP), 6 cifre, 30 sekunder</dd>
                  </dl>
                  <p className="mt-3 text-xs text-muted">Del aldrig QR-koden eller nøglen med andre. Opsætningen gælder i 30 minutter.</p>
                </div>
              </div>
            </section>
            <section aria-labelledby="s3">
              <h2 id="s3" className="text-xl">3. Bekræft med en kode</h2>
              <p className="mb-space-3 mt-2 text-sm text-muted">Indtast den 6-cifrede kode, appen viser nu. Derefter får du 10 gendannelseskoder.</p>
              <MfaSetupForm next={next} email={ctx.user.email} />
            </section>
            <div className="border-t border-grey-bg pt-space-3 text-sm text-muted">
              {forced ? (
                <form action={logoutAction}>
                  <button type="submit" className="underline hover:text-gold-ink">Log ud</button>
                </form>
              ) : (
                <Link href="/account#totrin">Annullér</Link>
              )}
            </div>
          </div>
        </div>
      </Band>
    </PageShell>
  );
}
