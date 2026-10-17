"use client";

import Link from "next/link";
import { useState } from "react";
import { ADVISOR_COUNTS, FREQUENCY_WEEKS, formatDkk, monthlyPriceDkk } from "@/lib/pricing";

export function PriceCalculator() {
  const [advisors, setAdvisors] = useState<number>(3);
  const [weeks, setWeeks] = useState<number>(8);
  const price = monthlyPriceDkk(advisors, weeks);
  const meetingsPerYear = Math.round(52 / weeks);

  return (
    <div className="panel">
      <h2>Beregn din pris</h2>
      <span className="rule-gold mt-3" aria-hidden="true" />
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <fieldset>
          <legend className="label">Antal rådgivere</legend>
          <div className="flex gap-2">
            {ADVISOR_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAdvisors(n)}
                aria-pressed={advisors === n}
                className={`flex-1 border px-3 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${
                  advisors === n ? "border-navy bg-navy text-white" : "border-slate bg-white text-navy hover:border-navy"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="label">Mødefrekvens</legend>
          <div className="flex gap-2">
            {FREQUENCY_WEEKS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWeeks(w)}
                aria-pressed={weeks === w}
                className={`flex-1 border px-3 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${
                  weeks === w ? "border-navy bg-navy text-white" : "border-slate bg-white text-navy hover:border-navy"
                }`}
              >
                Hver {w}. uge
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="mt-6 border-t border-navy pt-space-4">
        <p className="text-sm text-muted">Din månedlige pris (ekskl. moms)</p>
        <p className="text-4xl font-light text-navy" data-testid="price">{formatDkk(price)} / md.</p>
        <p className="mt-1 text-xs text-muted">
          {advisors} rådgivere · ca. {meetingsPerYear} møder om året · 1.750 kr. pr. rådgiver pr. møde
        </p>
      </div>
      <Link href="/signup" className="btn mt-6 w-full sm:w-auto">
        Kom i gang
      </Link>
    </div>
  );
}
