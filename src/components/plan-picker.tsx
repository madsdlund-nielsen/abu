"use client";

import { useState } from "react";
import { ADVISOR_COUNTS, FREQUENCY_WEEKS, formatDkk, monthlyPriceDkk } from "@/lib/pricing";

export interface PickerAdvisor {
  id: string;
  name: string;
  title: string;
  bio: string;
  expertise: string[];
}

export function PlanPicker({
  advisors,
  action,
  submitLabel,
  initialCount = 3,
  initialWeeks = 8,
  initialSelected = [],
}: {
  advisors: PickerAdvisor[];
  action: (formData: FormData) => void | Promise<void>;
  submitLabel: string;
  initialCount?: number;
  initialWeeks?: number;
  initialSelected?: string[];
}) {
  const [count, setCount] = useState(initialCount);
  const [weeks, setWeeks] = useState(initialWeeks);
  const [selected, setSelected] = useState<string[]>(initialSelected.slice(0, initialCount));

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < count ? [...s, id] : s));
  const changeCount = (n: number) => {
    setCount(n);
    setSelected((s) => s.slice(0, n));
  };
  const ready = selected.length === count;

  const choice = (active: boolean) =>
    `flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
      active ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
    }`;

  return (
    <form action={action} className="space-y-8">
      <input type="hidden" name="advisors" value={count} />
      <input type="hidden" name="weeks" value={weeks} />
      {selected.map((id) => (
        <input key={id} type="hidden" name="advisorIds" value={id} />
      ))}

      <section className="card">
        <h2>1. Antal rådgivere</h2>
        <div className="mt-3 flex gap-2">
          {ADVISOR_COUNTS.map((n) => (
            <button key={n} type="button" className={choice(count === n)} aria-pressed={count === n} onClick={() => changeCount(n)}>
              {n} rådgivere
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>2. Hvor ofte?</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {FREQUENCY_WEEKS.map((w) => (
            <button key={w} type="button" className={choice(weeks === w)} aria-pressed={weeks === w} onClick={() => setWeeks(w)}>
              Hver {w}. uge
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>
          3. Vælg dit board{" "}
          <span className="text-sm font-normal text-slate-500">
            ({selected.length} af {count} valgt)
          </span>
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {advisors.map((a) => {
            const on = selected.includes(a.id);
            const disabled = !on && selected.length >= count;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(a.id)}
                disabled={disabled}
                aria-pressed={on}
                className={`rounded-xl border p-4 text-left transition ${
                  on ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 bg-white hover:border-slate-300"
                } ${disabled ? "opacity-50" : ""}`}
              >
                <span className="block font-semibold">{a.name}</span>
                <span className="block text-sm text-brand-700">{a.title}</span>
                <span className="mt-1 line-clamp-3 block text-sm text-slate-600">{a.bio}</span>
                {a.expertise.length > 0 && (
                  <span className="mt-2 flex flex-wrap gap-1">
                    {a.expertise.map((e) => (
                      <span key={e} className="badge bg-slate-100 text-slate-700">{e}</span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-slate-600">Månedlig pris (ekskl. moms)</p>
          <p className="text-2xl font-semibold text-brand-700">{formatDkk(monthlyPriceDkk(count, weeks))} / md.</p>
        </div>
        <button className="btn" type="submit" disabled={!ready}>
          {ready ? submitLabel : `Vælg ${count - selected.length} mere`}
        </button>
      </section>
    </form>
  );
}
