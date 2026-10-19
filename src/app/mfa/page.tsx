import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { Band } from "@/components/band";
import { flashFrom, type SP } from "@/components/flash";
import { MfaVerifyForm } from "@/components/mfa-forms";
import { PageShell } from "@/components/site-header";
import { getSessionContext } from "@/lib/auth";
import { safeNextPath } from "@/lib/consent";
import { getTrustedDeviceDays } from "@/lib/mfa/service";
import { landingPath } from "@/lib/sign-in";

export const metadata: Metadata = { title: "Totrinsbekræftelse" };
export const dynamic = "force-dynamic";

/** Login, trin 2. Kun en session, hvor adgangskoden er godkendt, men koden mangler, kan se siden. */
export default async function MfaVerifyPage({ searchParams }: { searchParams: SP }) {
  const ctx = await getSessionContext();
  const { one, params } = await flashFrom(searchParams);
  const next = safeNextPath(one(params.next));
  if (!ctx) redirect("/login");
  if (ctx.stage === "full") redirect(landingPath(ctx.user, next));
  if (ctx.stage === "mfa_setup") redirect("/mfa/opsaet");
  const days = await getTrustedDeviceDays();
  return (
    <PageShell variant="bare">
      <Band tone="grey">
        <div className="mx-auto max-w-md">
          <span className="eyebrow">Login · trin 2 af 2</span>
          <h1>Totrinsbekræftelse</h1>
          <div className="panel mt-space-5">
            <p className="mb-space-4 text-sm text-muted">
              Åbn din godkendelses-app (fx Authy, Google Authenticator eller 1Password), og indtast koden for{" "}
              <span className="font-semibold text-ink">{ctx.user.email}</span>.
            </p>
            <MfaVerifyForm next={next} rememberDays={days} />
            <form action={logoutAction} className="mt-space-4 border-t border-grey-bg pt-space-3 text-sm text-muted">
              <p>Ikke dig, eller vil du afbryde?</p>
              <button type="submit" className="mt-1 underline hover:text-gold-ink">Log ud</button>
            </form>
          </div>
        </div>
      </Band>
    </PageShell>
  );
}
