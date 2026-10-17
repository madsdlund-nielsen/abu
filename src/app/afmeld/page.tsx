import type { Metadata } from "next";
import { unsubscribeAction } from "@/app/actions/notifications-public";
import { Band } from "@/components/band";
import type { SP } from "@/components/flash";
import { PageShell } from "@/components/site-header";
import { formatPhone } from "@/lib/phone";
import { verifyUnsubscribeToken } from "@/lib/notifications/unsubscribe";

export const metadata: Metadata = { title: "Afmeld beskeder" };
export const dynamic = "force-dynamic";

/**
 * Afmelding via link i e-mail/SMS. Siden viser en bekræftelse, og selve afmeldingen sker først ved klik (POST),
 * så mailscannere og link-forhåndsvisninger ikke afmelder ved et uheld.
 */
export default async function Afmeld({ searchParams }: { searchParams: SP }) {
  const p = await searchParams;
  const t = Array.isArray(p.t) ? p.t[0] : p.t;
  const done = Boolean(p.done);
  const claim = t ? verifyUnsubscribeToken(t) : null;
  return (
    <PageShell variant="bare">
      <Band tone="grey" tight className="min-h-[60vh]">
        <div className="mx-auto max-w-xl pt-space-4">
          <span className="eyebrow">Beskeder</span>
          <h1>{done ? "Du er afmeldt" : "Afmeld beskeder"}</h1>
          <div className="panel mt-space-5">
            {done ? (
              <p>Vi sender ikke flere ikke-obligatoriske {p.k === "SMS" ? "SMS'er" : "e-mails"} til dig. Beskeder om konto og adgangskode kan du stadig modtage.</p>
            ) : !claim ? (
              <p role="alert" className="callout callout-error text-sm">Linket er ugyldigt. Brug linket i den seneste besked, eller log ind og ret indstillingerne under Konto.</p>
            ) : (
              <form action={unsubscribeAction} className="grid gap-4">
                <input type="hidden" name="t" value={t} />
                <p>
                  Vil du afmelde {claim.channel === "SMS" ? "SMS'er" : "e-mails"} til{" "}
                  <span className="font-semibold text-navy">{claim.channel === "SMS" ? formatPhone(claim.address) : claim.address}</span>?
                </p>
                <div><button className="btn" type="submit">Ja, afmeld</button></div>
              </form>
            )}
          </div>
        </div>
      </Band>
    </PageShell>
  );
}
