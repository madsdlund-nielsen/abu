import type { Metadata } from "next";
import { Band } from "@/components/band";
import { PageShell } from "@/components/site-header";

export const metadata: Metadata = { title: "Vilkår" };

export default function Vilkaar() {
  return (
    <PageShell variant="bare">
      <Band tone="white">
      <div className="max-w-3xl">
      <h1>Vilkår</h1>
      <p className="callout mt-space-4 text-sm">
        Skabelon – skal gennemgås og tilpasses af jurist før lancering.
      </p>
      <div className="mt-space-5 space-y-6 text-ink">
        <section>
          <h2>1. Ydelsen</h2>
          <p>Advisory Board Unlimited leverer rådgivningsmøder med et antal rådgivere og en mødefrekvens, som kunden vælger ved tilmelding.</p>
        </section>
        <section>
          <h2>2. Pris og betaling</h2>
          <p>Prisen er 1.750 kr. pr. rådgiver pr. møde ekskl. moms, opkrævet som en fast månedlig betaling via Frisbii.</p>
        </section>
        <section>
          <h2>3. Booking og aflysning</h2>
          <p>
            Der kan bookes ét møde pr. periode (svarende til den valgte frekvens). Aflysning mindst 48 timer før mødets start
            frigiver mødet; senere aflysning tæller som afholdt.
          </p>
        </section>
        <section>
          <h2>4. Opsigelse</h2>
          <p>Abonnementet kan opsiges under &quot;Konto&quot;. [Opsigelsesvarsel og binding indsættes.]</p>
        </section>
        <section>
          <h2>5. Optagelse</h2>
          <p>Møder optages og transskriberes automatisk. Kunden giver udtrykkeligt samtykke hertil ved oprettelsen af kontoen, og rådgivere ved accept af invitationen. Se privatlivspolitikken.</p>
        </section>
        <section>
          <h2>6. Ansvar og fortrolighed</h2>
          <p>[Ansvarsbegrænsning, fortrolighed og lovvalg indsættes.]</p>
        </section>
      </div>
      </div>
      </Band>
    </PageShell>
  );
}
