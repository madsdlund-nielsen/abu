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
    <div className="card">
      <h2>Beregn din pris</h2>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <fieldset>
          <legend className="label">Antal rådgivere</legend>
          <div className="flex gap-2">
            {ADVISOR_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAdvisors(n)}
                aria-pressed={advisors === n}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                  advisors === n ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-700"
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
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                  weeks === w ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                Hver {w}. uge
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="mt-6 rounded-lg bg-brand-50 p-4">
        <p className="text-sm text-slate-600">Din månedlige pris (ekskl. moms)</p>
        <p className="text-3xl font-semibold text-brand-700" data-testid="price">{formatDkk(price)} / md.</p>
        <p className="mt-1 text-xs text-slate-500">
          {advisors} rådgivere · ca. {meetingsPerYear} møder om året · 1.750 kr. pr. rådgiver pr. møde
        </p>
      </div>
      <Link href="/signup" className="btn mt-4 w-full sm:w-auto">
        Kom i gang
      </Link>
    </div>
  );
}
