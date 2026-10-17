import type { Metadata } from "next";
import Link from "next/link";
import { PriceCalculator } from "@/components/price-calculator";
import { PageShell } from "@/components/site-header";
import { ADVISOR_COUNTS, FREQUENCY_WEEKS, formatDkk, monthlyPriceDkk } from "@/lib/pricing";

export const metadata: Metadata = { title: "Priser" };

export default function Priser() {
  return (
    <PageShell>
      <h1>Priser</h1>
      <p className="mt-2 text-slate-600">
        Du betaler 1.750 kr. pr. rådgiver pr. møde (ekskl. moms), fordelt jævnt på en fast månedlig betaling.
      </p>
      <div className="table-wrap mt-6">
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
                <td className="font-medium">Hver {w}. uge</td>
                {ADVISOR_COUNTS.map((n) => (
                  <td key={n}>{formatDkk(monthlyPriceDkk(n, w))} / md.</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">Formel: rådgivere × 1.750 kr. × (52 / uger) / 12, afrundet til hele kroner.</p>
      <div className="mt-8">
        <PriceCalculator />
      </div>
      <p className="mt-6 text-sm">
        <Link href="/signup">Opret konto og kom i gang</Link>
      </p>
    </PageShell>
  );
}
