import type { Metadata } from "next";
import { Band } from "@/components/band";
import { PageShell } from "@/components/site-header";

export const metadata: Metadata = { title: "Privatlivspolitik" };

export default function Privatliv() {
  return (
    <PageShell variant="bare">
      <Band tone="white">
      <div className="max-w-3xl">
      <h1>Privatlivspolitik</h1>
      <p className="callout mt-space-4 text-sm">
        Skabelon – skal gennemgås og tilpasses af jurist før lancering.
      </p>
      <div className="mt-space-5 space-y-6 text-ink">
        <section>
          <h2>Dataansvarlig</h2>
          <p>Advisory Board Unlimited [firmanavn, CVR, adresse, kontakt-e-mail] er dataansvarlig for behandlingen af dine personoplysninger.</p>
        </section>
        <section>
          <h2>Hvilke oplysninger behandler vi?</h2>
          <ul className="list-disc pl-5">
            <li>Kontooplysninger: navn, e-mail, telefon, firmanavn, CVR og adresse.</li>
            <li>Abonnements- og betalingsstatus (selve kortoplysningerne håndteres af Frisbii og ses aldrig af os).</li>
            <li>Møder: tidspunkt, deltagere samt lyd/video-optagelse, transskription og resumé.</li>
            <li>Tekniske data: session-cookie til login. Vi bruger ingen tracking- eller analyse-cookies.</li>
          </ul>
        </section>
        <section>
          <h2>Optagelse og transskription af møder</h2>
          <p>
            Møder optages og transskriberes automatisk, så deltagerne kan læse en transskription og et resumé efter mødet.
            Optagelsen slettes fra vores lager, når transskriptionen er færdig. Transskription og resumé gemmes, så længe
            abonnementet består, og slettes efter [periode] derefter.
          </p>
        </section>
        <section>
          <h2>Databehandlere (alle i EU/EØS)</h2>
          <ul className="list-disc pl-5">
            <li>Hetzner Online GmbH (DE) – hosting og objektlagring</li>
            <li>Frisbii / Reepay (DK) – betalinger</li>
            <li>Whereby AS (NO) – videomøder</li>
            <li>Mistral AI (FR) – transskription og resumé</li>
            <li>[SMTP-udbyder, fx Simply.com (DK) eller Brevo (FR)] – e-mail</li>
          </ul>
        </section>
        <section>
          <h2>Dine rettigheder</h2>
          <p>
            Du kan til enhver tid downloade dine data og anmode om sletning under &quot;Konto&quot;. Du har ret til indsigt,
            berigtigelse, sletning, begrænsning, dataportabilitet og indsigelse, og du kan klage til Datatilsynet.
          </p>
        </section>
      </div>
      </div>
      </Band>
    </PageShell>
  );
}
