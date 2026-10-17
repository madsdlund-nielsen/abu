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
          <p className="mt-2">
            Du giver et udtrykkeligt samtykke til optagelse og transskription, når du opretter din konto (kunder) eller accepterer din
            invitation (rådgivere). Vi gemmer tidspunktet og versionen af den tekst, du accepterede. Mødesiden viser kun en kort
            informationslinje om optagelsen. Du kan trække samtykket tilbage ved at kontakte os, men så kan du ikke deltage i møder.
          </p>
        </section>
        <section>
          <h2>Påmindelser og beskeder (e-mail og SMS)</h2>
          <p>
            Vi sender bekræftelser, påmindelser og beskeder om dine møder og dit abonnement på e-mail og SMS. Det sker for at opfylde
            aftalen med dig og kræver ikke samtykke. Du kan slå e-mail eller SMS fra under &quot;Konto&quot;. Vi gemmer en log over
            sendte beskeder (modtager, tidspunkt, status og de første linjer af teksten) i [12] måneder.
          </p>
        </section>
        <section>
          <h2>Kontakt før du er kunde (markedsføring)</h2>
          <p>
            Når du udfylder første trin i tilmeldingen, gemmer vi dit navn og din e-mail, selv om du ikke gør tilmeldingen færdig. Hvis du
            aktivt har sat kryds i feltet om samtykke, må vi kontakte dig på e-mail og SMS med opfølgning og relevante tilbud, og vi gemmer
            samtykket med den præcise tekst, du så, tidspunkt, kilde og teknisk dokumentation (IP-adresse og browser). Uden samtykke
            kontakter vi dig ikke, og oplysningerne slettes, når tilmeldingen udløber (7 dage). Med samtykke gemmer vi dem, til du trækker
            samtykket tilbage via afmeldingslinket i beskeden eller under &quot;Konto&quot;, og højst [24] måneder efter din seneste aktivitet.
          </p>
        </section>
        <section>
          <h2>Databehandlere (alle i EU/EØS)</h2>
          <ul className="list-disc pl-5">
            <li>Hetzner Online GmbH (DE) – hosting og objektlagring</li>
            <li>Frisbii / Reepay (DK) – betalinger</li>
            <li>Whereby AS (NO) – videomøder</li>
            <li>Mistral AI (FR) – transskription og resumé</li>
            <li>inMobile ApS (DK) – SMS og e-mail (påmindelser og beskeder)</li>
            <li>[SMTP-udbyder, fx Simply.com (DK) eller Brevo (FR)] – e-mail, hvis den bruges i stedet</li>
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
