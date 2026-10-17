"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BuilderAdvisor, BuilderTag } from "@/lib/onboarding/catalog";
import { advisorScore, boardCoverage } from "@/lib/matching";
import { FREQUENCY_WEEKS, MAX_BOARD_SIZE, MIN_BOARD_SIZE, formatDkk, frequencyLabel, monthlyPriceForBoard, vatBreakdown } from "@/lib/pricing";
import { Initials } from "./ui";

type Mode = { kind: "replace"; targetId: string } | { kind: "add" };

const nf = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 1 });

export interface BoardTexts {
  sideEyebrow: string;
  replace: string;
  remove: string;
  add: string;
  frequency: string;
  priceLabel: string;
  catalogEyebrow: string;
}

const DEFAULT_TEXTS: BoardTexts = {
  sideEyebrow: "Dit board",
  replace: "Udskift",
  remove: "Fjern",
  add: "Tilføj rådgiver",
  frequency: "Mødefrekvens",
  priceLabel: "Månedspris (ekskl. moms)",
  catalogEyebrow: "Rådgiverkatalog",
};

export interface BoardBuilderProps {
  advisors: BuilderAdvisor[];
  tags: BuilderTag[];
  /** Kundens behov fra testen: tag-id -> samlet vægt. Tomt objekt = ingen test. */
  needs: Record<string, number>;
  initialAdvisorIds: string[];
  initialWeeks: number | null;
  action: (formData: FormData) => void | Promise<void>;
  submitLabel: string;
  backHref?: string;
  /** Kort forklaring over kortene */
  intro?: string;
  /** Redigerbare tekster (onboarding-CMS). Mangler de, bruges standardtekster. */
  texts?: Partial<BoardTexts>;
  /** Ekstra felter i formularen under rådgiverkortene (fx admin-valg) */
  children?: React.ReactNode;
}

export function BoardBuilder({ advisors, tags, needs, initialAdvisorIds, initialWeeks, action, submitLabel, backHref, intro, texts, children }: BoardBuilderProps) {
  const tx: BoardTexts = { ...DEFAULT_TEXTS, ...texts };
  const byId = useMemo(() => new Map(advisors.map((a) => [a.id, a])), [advisors]);
  const tagName = useMemo(() => new Map(tags.map((t) => [t.id, t.name])), [tags]);
  const [selected, setSelected] = useState<string[]>(() => initialAdvisorIds.filter((id) => byId.has(id)).slice(0, MAX_BOARD_SIZE));
  const [weeks, setWeeks] = useState<number | null>(initialWeeks);
  const [mode, setMode] = useState<Mode | null>(null);
  const [open, setOpen] = useState(false);

  const board = selected.map((id) => byId.get(id)).filter((a): a is BuilderAdvisor => Boolean(a));
  const hasNeeds = Object.values(needs).some((n) => n > 0);
  const validSize = board.length >= MIN_BOARD_SIZE && board.length <= MAX_BOARD_SIZE;
  const ready = validSize && weeks !== null;
  const perMeeting = board.reduce((a, b) => a + b.priceDkk, 0);
  const monthly = validSize && weeks ? monthlyPriceForBoard(board.map((a) => a.priceDkk), weeks) : null;
  const vat = monthly !== null ? vatBreakdown(monthly) : null;

  const boardTagIds = [...new Set(board.flatMap((a) => a.tags.map((t) => t.id)))];
  const coverage = boardCoverage(needs, boardTagIds);
  const coveredSet = new Set(coverage.covered);

  const reasonFor = (a: BuilderAdvisor) => {
    const matched = a.tags.filter((t) => (needs[t.id] ?? 0) > 0).sort((x, y) => needs[y.id] - needs[x.id]);
    return matched.slice(0, 3).map((t) => t.name);
  };

  const replace = (targetId: string, newId: string) => setSelected((s) => s.map((id) => (id === targetId ? newId : id)));
  const add = (id: string) => setSelected((s) => (s.length < MAX_BOARD_SIZE ? [...s, id] : s));
  const remove = (id: string) => setSelected((s) => (s.length > MIN_BOARD_SIZE ? s.filter((x) => x !== id) : s));

  const hint = !validSize
    ? `Vælg ${MIN_BOARD_SIZE}-${MAX_BOARD_SIZE} rådgivere (nu ${board.length}).`
    : weeks === null
      ? "Vælg hvor ofte I vil mødes."
      : null;

  return (
    <form action={action} className="relative pb-24 lg:pb-0">
      {selected.map((id) => (
        <input key={id} type="hidden" name="advisorIds" value={id} />
      ))}
      {weeks !== null && <input type="hidden" name="weeks" value={weeks} />}

      <div className="grid items-start gap-space-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          {intro && <p className="mb-space-4 max-w-2xl text-muted">{intro}</p>}
          <ul className="grid gap-space-3 sm:grid-cols-2" aria-label="Dit board">
            {board.map((a) => {
              const reason = reasonFor(a);
              return (
                <li key={a.id} className="flex flex-col border border-grey-bg bg-white p-space-3 shadow-panel" data-testid="board-card" data-advisor={a.name}>
                  <div className="flex items-start gap-3">
                    <Initials name={a.name} url={a.photoUrl} />
                    <div className="min-w-0">
                      <p className="font-semibold leading-snug text-navy">{a.name}</p>
                      <p className="text-sm leading-snug text-muted">{a.title}</p>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-3 text-sm text-muted">{a.bio}</p>
                  <ul className="mt-3 flex flex-wrap gap-1" aria-label="Kompetencer">
                    {a.tags.map((t) => (
                      <li key={t.id} className={`badge ${(needs[t.id] ?? 0) > 0 ? "badge-navy" : "badge-muted"}`}>
                        {t.name}
                      </li>
                    ))}
                  </ul>
                  {hasNeeds && (
                    <p className="mt-3 text-sm">
                      <span className="font-semibold text-navy">{reason.length ? "Matcher: " : "Supplerer boardet"}</span>
                      {reason.join(", ")}
                    </p>
                  )}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-grey-bg pt-3">
                    <p className="text-sm font-semibold text-navy">{formatDkk(a.priceDkk)} <span className="font-normal text-muted">pr. møde</span></p>
                    <div className="flex gap-2">
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setMode({ kind: "replace", targetId: a.id })} aria-label={`Udskift ${a.name}`}>
                        {tx.replace}
                      </button>
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        onClick={() => remove(a.id)}
                        disabled={board.length <= MIN_BOARD_SIZE}
                        title={board.length <= MIN_BOARD_SIZE ? "Et board har mindst 2 rådgivere" : undefined}
                        aria-label={`Fjern ${a.name}`}
                      >
                        {tx.remove}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
            {board.length < MAX_BOARD_SIZE && (
              <li className="flex min-h-40 items-center justify-center border border-dashed border-slate bg-white p-space-3">
                <button type="button" className="btn-secondary" onClick={() => setMode({ kind: "add" })}>
                  {tx.add}
                </button>
              </li>
            )}
          </ul>
          {children}
        </div>

        {/* Sidepanel: sticky på desktop, bundbar der kan foldes ud på mobil */}
        <aside
          aria-label="Resumé af dit board"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-navy bg-white shadow-panel lg:static lg:sticky lg:top-6 lg:z-auto lg:border-t-0"
        >
          <div className="flex items-center gap-3 px-4 py-3 lg:hidden">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              aria-expanded={open}
              aria-controls="board-summary"
              onClick={() => setOpen((v) => !v)}
            >
              <span className="block text-xs font-bold uppercase tracking-wide text-muted">
                {board.length} rådgivere · Oversigt <span aria-hidden="true">{open ? "▾" : "▴"}</span>
              </span>
              <span className="block truncate text-xl font-light text-navy" data-testid="price-mobile">
                {monthly !== null ? `${formatDkk(monthly)} / md.` : "Vælg frekvens"}
              </span>
            </button>
            <button className="btn shrink-0" type="submit" disabled={!ready}>
              {submitLabel}
            </button>
          </div>

          <div
            id="board-summary"
            className={`${open ? "block" : "hidden"} max-h-[65vh] overflow-y-auto border-t border-grey-bg px-4 pb-4 pt-4 lg:block lg:max-h-none lg:overflow-visible lg:border-t-0 lg:bg-white lg:p-space-4 lg:shadow-panel`}
          >
            <span className="eyebrow !mb-2">{tx.sideEyebrow}</span>
            <h2 className="text-xl font-light">
              {board.length} rådgivere
            </h2>
            <span className="rule-gold mt-3" aria-hidden="true" />

            <fieldset className="mt-space-4">
              <legend className="label">{tx.frequency}</legend>
              <div className="grid grid-cols-3 gap-2">
                {FREQUENCY_WEEKS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={weeks === w}
                    onClick={() => setWeeks(w)}
                    className={`whitespace-nowrap border px-1 py-2 text-[11px] font-bold uppercase tracking-wide transition-colors ${
                      weeks === w ? "border-navy bg-navy text-white" : "border-slate bg-white text-navy hover:border-navy"
                    }`}
                  >
                    Hver {w}. uge
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-space-4">
              <p className="label">Boardets kompetencer</p>
              {boardTagIds.length === 0 ? (
                <p className="text-sm text-muted">Ingen rådgivere valgt endnu.</p>
              ) : (
                <ul className="flex flex-wrap gap-1">
                  {boardTagIds.map((id) => (
                    <li key={id} className={`badge ${coveredSet.has(id) ? "badge-navy" : "badge-muted"}`}>
                      {tagName.get(id) ?? id}
                    </li>
                  ))}
                </ul>
              )}
              {hasNeeds && (
                <div className="mt-space-3">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-bold uppercase tracking-wide text-navy">Dækning af jeres behov</span>
                    <span className="text-muted" data-testid="coverage">{Math.round(coverage.coverage * 100)} %</span>
                  </div>
                  <div className="mt-1 h-1 bg-grey-bg" role="presentation">
                    <div className="h-1 bg-navy transition-all" style={{ width: `${Math.round(coverage.coverage * 100)}%` }} />
                  </div>
                  {coverage.uncovered.length > 0 ? (
                    <div className="mt-space-2">
                      <p className="text-xs text-muted">Ikke dækket af boardet:</p>
                      <ul className="mt-1 flex flex-wrap gap-1">
                        {coverage.uncovered.map((id) => (
                          <li key={id} className="badge badge-gold">{tagName.get(id) ?? id}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted">Boardet dækker alle de områder, I pegede på i testen.</p>
                  )}
                </div>
              )}
            </div>

            <dl className="mt-space-4 border-t border-navy pt-space-3">
              <dt className="text-sm text-muted">{tx.priceLabel}</dt>
              <dd className="text-3xl font-light text-navy" data-testid="price" aria-live="polite">
                {monthly !== null ? `${formatDkk(monthly)} / md.` : weeks === null ? "Vælg frekvens" : "Vælg 2-4 rådgivere"}
              </dd>
              {vat && <dd className="text-xs text-muted">{formatDkk(vat.incVat)} inkl. 25 % moms</dd>}
              <div className="mt-space-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted">Pris pr. møde, hele boardet</dt>
                <dd className="text-right font-semibold text-navy" data-testid="per-meeting">{formatDkk(perMeeting)}</dd>
                <dt className="text-muted">Møder om året</dt>
                <dd className="text-right font-semibold text-navy">{weeks ? `ca. ${nf.format(52 / weeks)}` : "–"}</dd>
                {weeks && (
                  <>
                    <dt className="text-muted">Frekvens</dt>
                    <dd className="text-right font-semibold text-navy">{frequencyLabel(weeks)}</dd>
                  </>
                )}
              </div>
            </dl>

            <div className="mt-space-4 hidden lg:block">
              <button className="btn w-full" type="submit" disabled={!ready}>
                {submitLabel}
              </button>
              {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
              {backHref && (
                <p className="mt-space-3 text-center text-sm">
                  <Link href={backHref}>Tilbage</Link>
                </p>
              )}
            </div>
            {hint && <p className="mt-space-3 text-xs text-muted lg:hidden">{hint}</p>}
            {backHref && (
              <p className="mt-space-3 text-sm lg:hidden">
                <Link href={backHref}>Tilbage</Link>
              </p>
            )}
          </div>
        </aside>
      </div>

      {mode && (
        <Catalog
          mode={mode}
          eyebrow={tx.catalogEyebrow}
          advisors={advisors}
          tags={tags}
          needs={needs}
          selected={selected}
          onClose={() => setMode(null)}
          onPick={(id) => {
            if (mode.kind === "replace") replace(mode.targetId, id);
            else add(id);
            setMode(null);
          }}
        />
      )}
    </form>
  );
}

function Catalog({
  mode,
  eyebrow,
  advisors,
  tags,
  needs,
  selected,
  onClose,
  onPick,
}: {
  mode: Mode;
  eyebrow: string;
  advisors: BuilderAdvisor[];
  tags: BuilderTag[];
  needs: Record<string, number>;
  selected: string[];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string[]>([]);
  const target = mode.kind === "replace" ? advisors.find((a) => a.id === mode.targetId) : null;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return advisors
      .filter((a) => !selected.includes(a.id) || a.id === target?.id)
      .filter((a) => a.id !== target?.id)
      .filter((a) => filter.length === 0 || a.tags.some((t) => filter.includes(t.id)))
      .filter((a) => !needle || [a.name, a.title, a.bio, ...a.tags.map((t) => t.name)].join(" ").toLowerCase().includes(needle))
      .map((a) => ({ a, score: advisorScore(a.tags.map((t) => t.id), needs) }))
      .sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name, "da"));
  }, [advisors, selected, target, filter, q, needs]);
  const hasNeeds = Object.values(needs).some((n) => n > 0);

  const TagChips = ({ className }: { className: string }) => (
    <ul className={className}>
      {tags.map((t) => {
        const on = filter.includes(t.id);
        return (
          <li key={t.id}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => setFilter((f) => (on ? f.filter((x) => x !== t.id) : [...f, t.id]))}
              className={`badge cursor-pointer ${on ? "badge-navy" : "badge-muted hover:border-navy"}`}
            >
              {t.name}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      aria-labelledby="catalog-title"
      className="m-0 ml-auto h-full max-h-none w-full max-w-xl border-0 bg-white p-0 text-ink backdrop:bg-overlay-navy sm:m-auto sm:h-[min(90vh,820px)] sm:border sm:border-grey-bg"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-grey-bg p-space-3 sm:p-space-4">
          <div>
            <span className="eyebrow !mb-2">{eyebrow}</span>
            <h2 id="catalog-title" className="text-xl font-light">
              {target ? `Udskift ${target.name}` : "Tilføj rådgiver"}
            </h2>
            <span className="rule-gold mt-3" aria-hidden="true" />
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>
            Luk
          </button>
        </div>
        <div className="border-b border-grey-bg p-space-3 sm:px-space-4">
          <label className="label" htmlFor="catalog-search">Søg</label>
          <input id="catalog-search" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Navn, titel eller kompetence" autoFocus />
          <details className="mt-space-3 sm:hidden">
            <summary className="label !mb-0 cursor-pointer">Filtrér på kompetence{filter.length > 0 && ` (${filter.length} valgt)`}</summary>
            <TagChips className="mt-2 flex flex-wrap gap-1" />
          </details>
          <div className="hidden sm:block">
            <p className="label mt-space-3">Filtrér på kompetence</p>
            <TagChips className="flex flex-wrap gap-1" />
          </div>
        </div>
        <ul className="flex-1 divide-y divide-grey-bg overflow-y-auto">
          {rows.length === 0 && <li className="p-space-4 text-center text-muted">Ingen rådgivere matcher søgningen.</li>}
          {rows.map(({ a, score }, i) => {
            const delta = target ? a.priceDkk - target.priceDkk : null;
            return (
              <li key={a.id} className="flex gap-3 p-space-3 sm:px-space-4" data-testid="catalog-row" data-advisor={a.name}>
                <Initials name={a.name} url={a.photoUrl} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug text-navy">
                    {a.name}
                    {hasNeeds && i === 0 && score > 0 && <span className="badge badge-gold ml-2 align-middle">Bedste match</span>}
                  </p>
                  <p className="text-sm text-muted">{a.title}</p>
                  <ul className="mt-2 flex flex-wrap gap-1">
                    {a.tags.map((t) => (
                      <li key={t.id} className={`badge ${(needs[t.id] ?? 0) > 0 ? "badge-navy" : "badge-muted"}`}>{t.name}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm">
                    <span className="font-semibold text-navy">{formatDkk(a.priceDkk)}</span> <span className="text-muted">pr. møde</span>
                    {delta !== null && delta !== 0 && (
                      <span className="text-muted"> ({delta > 0 ? "+" : "−"}{formatDkk(Math.abs(delta))})</span>
                    )}
                    {hasNeeds && <span className="text-muted"> · match {score}</span>}
                  </p>
                </div>
                <button type="button" className="btn btn-sm self-center" onClick={() => onPick(a.id)} aria-label={`Vælg ${a.name}`}>
                  Vælg
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </dialog>
  );
}
