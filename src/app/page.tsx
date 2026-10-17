import Link from "next/link";
import { PriceCalculator } from "@/components/price-calculator";
import { PageShell } from "@/components/site-header";

export default function Home() {
  return (
    <PageShell wide>
      <section className="grid items-center gap-10 py-6 lg:grid-cols-2">
        <div>
          <h1 className="text-4xl sm:text-5xl">Din egen advisory board – som abonnement</h1>
          <p className="mt-4 text-lg text-slate-600">
            Få faste møder med 2-4 erfarne rådgivere, der kender din virksomhed. Book online, mød op i videomødet og få en
            skriftlig opsummering med beslutninger og handlingspunkter bagefter.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/signup" className="btn">Opret konto</Link>
            <Link href="/priser" className="btn-secondary">Se priser</Link>
          </div>
        </div>
        <PriceCalculator />
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          ["1. Vælg din board", "Vælg antal rådgivere og hvor ofte I mødes, og sammensæt boardet fra vores rådgiverpulje."],
          ["2. Book mødet", "Se tidspunkter, hvor alle jeres rådgivere er ledige, og book med få klik."],
          ["3. Få overblik", "Mødet afholdes online, transskriberes og opsummeres automatisk, så I kan handle på det."],
        ].map(([t, d]) => (
          <div key={t} className="card">
            <h3>{t}</h3>
            <p className="mt-2 text-sm text-slate-600">{d}</p>
          </div>
        ))}
      </section>

      <section className="mt-12 card">
        <h2>Data i EU</h2>
        <p className="mt-2 text-sm text-slate-600">
          Vi bruger udelukkende europæiske leverandører til hosting, betaling, video og transskription. Møder optages kun
          med jeres viden, og optagelsen slettes, når transskriptionen er færdig.
        </p>
      </section>
    </PageShell>
  );
}
