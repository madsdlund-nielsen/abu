import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { acceptRecordingConsentAction } from "@/app/actions/account";
import { logoutAction } from "@/app/actions/auth";
import { Band } from "@/components/band";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { PageShell } from "@/components/site-header";
import { requireUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/consent";
import { getOnboardingTexts } from "@/lib/content/server";
import { Rich } from "@/components/rich";

export const metadata: Metadata = { title: "Samtykke til optagelse" };
export const dynamic = "force-dynamic";

/** Engangs-accept for eksisterende brugere, der endnu ikke har givet samtykke til optagelse og transskription. */
export default async function Samtykke({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const { err, one, params } = await flashFrom(searchParams);
  const next = safeNextPath(one(params.next));
  const texts = await getOnboardingTexts();
  if (user.recordingConsentAt) redirect(next ?? (user.role === "ADMIN" ? "/admin" : "/dashboard"));
  return (
    <PageShell variant="bare">
      <Band tone="grey" tight className="min-h-[60vh]">
        <div className="mx-auto max-w-xl pt-space-4">
          <span className="eyebrow">Én gang</span>
          <h1>Samtykke til optagelse og transskription</h1>
          <div className="panel mt-space-5">
            <Flash err={err} />
            <p className="text-muted">
              Vores møder optages og transskriberes automatisk, så deltagerne kan læse en transskription og et resumé bagefter.
              Optagelsen slettes, når transskriptionen er færdig. Vi har brug for dit samtykke, før du kan deltage i møder.
            </p>
            <form action={acceptRecordingConsentAction} className="mt-space-4 grid gap-4">
              {next && <input type="hidden" name="next" value={next} />}
              <label className="flex items-start gap-3 border-l-4 border-gold bg-grey-bg px-4 py-3 text-sm text-ink">
                <input type="checkbox" name="recordingConsent" className="mt-1 h-4 w-4 shrink-0" required />
                <span>
                  <Rich text={texts["step6.recordingConsent"]} /> Læs mere i{" "}
                  <Link href="/privatliv" target="_blank">privatlivspolitikken</Link>.
                </span>
              </label>
              <div className="flex items-center justify-between gap-3">
                <button className="btn" type="submit">Giv samtykke og fortsæt</button>
              </div>
            </form>
            <form action={logoutAction} className="mt-space-4 border-t border-grey-bg pt-space-3 text-sm text-muted">
              <p>Vil du ikke give samtykke nu? Du kan stadig bruge resten af tjenesten, men ikke deltage i møder.</p>
              <button type="submit" className="mt-2 underline hover:text-gold-ink">Log ud</button>
            </form>
          </div>
        </div>
      </Band>
    </PageShell>
  );
}
