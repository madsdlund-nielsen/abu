import type { Metadata } from "next";
import Link from "next/link";
import { setPasswordAction } from "@/app/actions/auth";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { Band } from "@/components/band";
import { PageShell } from "@/components/site-header";
import { findValidPasswordToken, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { getOnboardingTexts } from "@/lib/content/server";
import { Rich } from "@/components/rich";

export const metadata: Metadata = { title: "Vælg adgangskode" };

export default async function SetPasswordPage({ searchParams }: { searchParams: SP }) {
  const { err, one, params } = await flashFrom(searchParams);
  const token = one(params.token) ?? "";
  const row = token ? await findValidPasswordToken(token) : null;
  const texts = await getOnboardingTexts();
  return (
    <PageShell variant="bare">
      <Band tone="grey">
      <div className="mx-auto max-w-md">
        <h1>{row?.purpose === "INVITE" ? "Velkommen – vælg din adgangskode" : "Vælg ny adgangskode"}</h1>
        <div className="panel mt-space-5">
          {!row ? (
            <>
              <p className="text-sm text-muted">Linket er ugyldigt eller udløbet.</p>
              <p className="mt-3 text-sm"><Link href="/reset-password">Bed om et nyt link</Link></p>
            </>
          ) : (
            <>
              <Flash err={err} />
              <p className="mb-4 text-sm text-muted">Konto: {row.user.email}</p>
              <form action={setPasswordAction} className="space-y-4">
                <input type="hidden" name="token" value={token} />
                <div>
                  <label className="label" htmlFor="password">Ny adgangskode (mindst {MIN_PASSWORD_LENGTH} tegn)</label>
                  <input className="input" id="password" name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
                </div>
                <div>
                  <label className="label" htmlFor="confirm">Gentag adgangskode</label>
                  <input className="input" id="confirm" name="confirm" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
                </div>
                {row.purpose === "INVITE" && (
                  <label className="flex items-start gap-3 border-l-4 border-gold bg-grey-bg px-4 py-3 text-sm text-ink">
                    <input type="checkbox" name="recordingConsent" className="mt-1 h-4 w-4 shrink-0" required />
                    <span>
                      <Rich text={texts["step6.recordingConsent"]} /> Se{" "}
                      <Link href="/privatliv" target="_blank">privatlivspolitikken</Link>.
                    </span>
                  </label>
                )}
                <button className="btn w-full" type="submit">Gem adgangskode</button>
              </form>
            </>
          )}
        </div>
      </div>
      </Band>
    </PageShell>
  );
}
