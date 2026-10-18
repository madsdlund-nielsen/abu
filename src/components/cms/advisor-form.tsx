"use client";

import Link from "next/link";
import { useState } from "react";
import { updateAdvisorAction } from "@/app/actions/cms";
import { formatDkk } from "@/lib/pricing";
import { SaveIndicator, useSaver } from "./primitives";

/** Pris og tags (gemmes samlet). Aktivering har sin egen knap (`AdvisorActivationControl`), så status aldrig er ugemt. */
export function AdvisorForm({
  userId,
  initial,
  tags,
  activeSubscriptions,
  priceBounds,
}: {
  userId: string;
  initial: { priceDkk: number; tagIds: string[] };
  tags: { id: string; name: string; active: boolean }[];
  activeSubscriptions: number;
  priceBounds: { min: number; max: number };
}) {
  const [price, setPrice] = useState(String(initial.priceDkk));
  const [tagIds, setTagIds] = useState(initial.tagIds);
  const [q, setQ] = useState("");
  const [saved, setSaved] = useState(initial);
  const [focus, setFocus] = useState(false);
  const saver = useSaver();

  const priceNum = Number(price.replace(/[^\d]/g, ""));
  const priceValid = price.trim() !== "" && Number.isInteger(priceNum) && priceNum >= priceBounds.min && priceNum <= priceBounds.max;
  const dirty = priceNum !== saved.priceDkk || [...tagIds].sort().join() !== [...saved.tagIds].sort().join();
  const visible = tags.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));

  const save = async () => {
    if (!priceValid) return;
    const r = await saver.run(() => updateAdvisorAction(userId, { priceDkk: priceNum, tagIds }));
    if (r?.ok) setSaved({ priceDkk: priceNum, tagIds });
  };

  return (
    <form
      className="grid gap-space-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"
      onSubmit={(e) => { e.preventDefault(); void save(); }}
    >
      <section className="border border-grey-bg bg-white p-space-3 sm:p-space-4">
        <h2 className="text-xl font-light">Pris pr. møde</h2>
        <span className="rule-gold mt-3" aria-hidden="true" />
        <div className="mt-space-4">
          <label className="label" htmlFor="price">Pris pr. møde (ekskl. moms)</label>
          <div className="relative max-w-[14rem]">
            <input
              id="price"
              className="input pr-12 text-right tabular-nums"
              inputMode="numeric"
              value={focus || !priceValid ? price : new Intl.NumberFormat("da-DK").format(priceNum)}
              onFocus={(e) => { setFocus(true); const el = e.currentTarget; requestAnimationFrame(() => el.select()); }}
              aria-invalid={!priceValid}
              aria-describedby="price-note"
              onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={() => { setFocus(false); if (priceValid) setPrice(String(priceNum)); }}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">kr.</span>
          </div>
          <p className="mt-1 text-sm text-navy" id="price-help">{priceValid ? formatDkk(priceNum) + " pr. møde" : <span className="text-danger" role="alert">Prisen skal ligge mellem {formatDkk(priceBounds.min)} og {formatDkk(priceBounds.max)} pr. møde.</span>}</p>
          <p id="price-note" className="callout mt-space-3 text-sm">
            Ændringer gælder kun <strong>nye abonnementer og planskift</strong>. Eksisterende abonnementer ({activeSubscriptions} aktive med denne rådgiver) beholder den pris, der var gældende ved køb.
          </p>
        </div>
      </section>

      <section className="border border-grey-bg bg-white p-space-3 sm:p-space-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-light">Kompetence-tags</h2>
          <span className="text-sm text-muted" data-testid="tag-count">{tagIds.length} valgt</span>
        </div>
        <span className="rule-gold mt-3" aria-hidden="true" />
        <div className="mt-space-3">
          <label className="label" htmlFor="tag-search">Søg i tags</label>
          <input id="tag-search" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søg" />
        </div>
        <ul className="mt-space-3 flex flex-wrap gap-2" aria-label="Tags">
          {visible.map((t) => {
            const on = tagIds.includes(t.id);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTagIds((ids) => (on ? ids.filter((x) => x !== t.id) : [...ids, t.id]))}
                  className={`border px-3 py-1.5 text-sm transition-colors ${on ? "border-navy bg-navy text-white" : "border-slate bg-white text-navy hover:border-navy"} ${t.active ? "" : "opacity-60"}`}
                >
                  <span aria-hidden="true" className="mr-1">{on ? "✓" : "+"}</span>
                  {t.name}{!t.active && " (inaktiv)"}
                </button>
              </li>
            );
          })}
          {visible.length === 0 && <li className="text-sm text-muted">Ingen tags matcher «{q}».</li>}
        </ul>
        {tagIds.length === 0 && <p className="mt-space-3 text-sm text-gold-ink">Uden tags kan rådgiveren ikke foreslås i onboarding-testen.</p>}
      </section>

      <div className="flex flex-wrap items-center gap-4 lg:col-span-2">
        <button className="btn" type="submit" disabled={!dirty || !priceValid || saver.status === "saving"}>Gem pris og tags</button>
        <Link href="/admin/advisors" className="btn-secondary">Tilbage til rådgivere</Link>
        <SaveIndicator saver={saver} />
      </div>
    </form>
  );
}
