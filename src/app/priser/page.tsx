import type { Metadata } from "next";
import Link from "next/link";
import { PriceCalculator } from "@/components/price-calculator";
import { Band, SectionHeading } from "@/components/band";
import { PageShell } from "@/components/site-header";
import { ADVISOR_COUNTS, FREQUENCY_WEEKS, formatDkk, monthlyPriceDkk } from "@/lib/pricing";

export const metadata: Metadata = { title: "Priser" };

export default function Priser() {
  return (
    <PageShell variant="bare">
      <Band tone="white">
        <SectionHeading eyebrow="Priser" title="Fast pris pr. måned" as="h1">
          <p className="text-muted">
            Du betaler for de rådgivere, du vælger, pr. møde (ekskl. moms), fordelt jævnt på en fast månedlig betaling. Standardprisen er 1.750 kr. pr. rådgiver pr. møde; nogle rådgivere har en anden pris, som du ser, når du sammensætter dit board.
          </p>
        </SectionHeading>
        <div className="table-wrap mt-space-5">
          <table className="table">
            <thead>
              <tr>
                <th>Mødefrekvens</th>
                {ADVISOR_COUNTS.map((n) => (
                  <th key={n}>{n} rådgivere</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FREQUENCY_WEEKS.map((w) => (
                <tr key={w}>
                  <td className="font-semibold text-navy">Hver {w}. uge</td>
                  {ADVISOR_COUNTS.map((n) => (
                    <td key={n}>fra {formatDkk(monthlyPriceDkk(n, w))} / md.</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-space-3 text-xs text-muted">Formel: summen af rådgivernes mødepriser × (52 / uger) / 12, afrundet til hele kroner. Tabellen viser «fra»-priser ved standardprisen 1.750 kr.; den endelige pris afhænger af de valgte rådgivere.</p>
      </Band>
      <Band tone="grey">
        <div className="mx-auto max-w-3xl">
          <PriceCalculator />
          <p className="mt-space-4 text-center">
            <Link href="/kom-i-gang">Opret konto og kom i gang</Link>
          </p>
        </div>
      </Band>
    </PageShell>
  );
}
