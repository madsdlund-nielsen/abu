import Link from "next/link";
import { Band, SectionHeading } from "@/components/band";
import { PriceCalculator } from "@/components/price-calculator";
import { PageShell } from "@/components/site-header";

const STEPS: [string, string, string][] = [
  ["01", "Vælg din board", "Vælg antal rådgivere og hvor ofte I mødes, og sammensæt boardet fra vores rådgiverpulje."],
  ["02", "Book mødet", "Se tidspunkter, hvor alle jeres rådgivere er ledige, og book med få klik."],
  ["03", "Få overblik", "Mødet afholdes online, transskriberes og opsummeres automatisk, så I kan handle på det."],
];

export default function Home() {
  return (
    <PageShell variant="bare">
      {/* Hero: charcoal, stor tynd hvid overskrift, guld-CTA */}
      <section className="band-charcoal on-dark py-section">
        <div className="container-abu">
          <span className="eyebrow">Rådgivning på abonnement</span>
          <h1 className="hero-title max-w-4xl">Din egen advisory board – som abonnement</h1>
          <p className="lead mt-space-4 max-w-2xl">
            Få faste møder med 2-4 erfarne rådgivere, der kender din virksomhed. Book online, mød op i videomødet og få en
            skriftlig opsummering med beslutninger og handlingspunkter bagefter.
          </p>
          <div className="mt-space-5 flex flex-wrap gap-4">
            <Link href="/signup" className="btn">Kom i gang</Link>
            <Link href="/priser" className="btn-outline-light">Se priser</Link>
          </div>
        </div>
      </section>

      {/* Hvidt bånd: sådan virker det */}
      <Band tone="white">
        <SectionHeading eyebrow="Sådan virker det" title="Tre skridt til jeres board" />
        <ol className="mt-space-5 grid gap-space-5 md:grid-cols-3">
          {STEPS.map(([n, t, d]) => (
            <li key={n}>
              <span className="rule-gold" aria-hidden="true" />
              <p className="mt-space-3 text-sm font-bold tracking-wide text-muted">{n}</p>
              <h3 className="mt-1">{t}</h3>
              <p className="mt-space-2 text-muted">{d}</p>
            </li>
          ))}
        </ol>
      </Band>

      {/* Lysegråt bånd: prisberegner som rent panel */}
      <Band tone="grey">
        <div className="grid items-start gap-space-5 lg:grid-cols-[5fr_7fr]">
          <SectionHeading eyebrow="Pris" title="Du betaler kun for møderne">
            <p className="text-muted">
              Prisen er fast pr. måned og afhænger af, hvor mange rådgivere der sidder i dit board, og hvor ofte I mødes.
              1.750 kr. pr. rådgiver pr. møde, ekskl. moms.
            </p>
          </SectionHeading>
          <PriceCalculator />
        </div>
      </Band>

      {/* Navy bånd: data i EU */}
      <Band tone="navy">
        <div className="grid gap-space-5 lg:grid-cols-2 lg:items-center">
          <SectionHeading eyebrow="Tryghed" title="Data i EU" />
          <p className="lead">
            Vi bruger udelukkende europæiske leverandører til hosting, betaling, video og transskription. Møder optages kun
            med jeres viden, og optagelsen slettes, når transskriptionen er færdig.
          </p>
        </div>
      </Band>

      {/* Hvidt bånd: afsluttende CTA */}
      <Band tone="white">
        <div className="flex flex-col gap-space-4 md:flex-row md:items-center md:justify-between">
          <div>
            <span className="eyebrow">Næste skridt</span>
            <h2 className="section-title">Klar til at sætte dit board?</h2>
            <span className="rule-gold mt-5" aria-hidden="true" />
          </div>
          <Link href="/signup" className="btn self-start md:self-auto">Opret konto</Link>
        </div>
      </Band>
    </PageShell>
  );
}
