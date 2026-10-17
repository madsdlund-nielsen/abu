"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { suggestBoard, type MatchAdvisor, type MatchAnswer } from "@/lib/matching";
import { formatDkk } from "@/lib/pricing";
import type { CmsAdvisor, CmsQuestion, CmsTag } from "@/lib/onboarding/cms-types";

const SIZE_REASON = {
  boardSize: "Størrelsen er bestemt af et svar om boardets størrelse (den største værdi vinder).",
  coverage: "Størrelsen er bestemt af dækningen: der tilføjes rådgivere, til mindst 80 % af behovet er dækket (2-4).",
  default: "Ingen behov i svarene, så standardstørrelsen 3 bruges.",
} as const;

/**
 * Forhåndsvisning af testen: admin tager testen som en kunde (intet gemmes) og ser forslaget med scores og begrundelse.
 * Bruger de aktuelle (også ikke-genindlæste) vægte, så effekten af en ændring ses med det samme.
 */
export function PreviewDrawer({
  open,
  onClose,
  questions,
  tags,
  advisors,
}: {
  open: boolean;
  onClose: () => void;
  questions: CmsQuestion[];
  tags: CmsTag[];
  advisors: CmsAdvisor[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const activeTags = useMemo(() => new Map(tags.filter((t) => t.active).map((t) => [t.id, t])), [tags]);
  const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? id;
  const quiz = useMemo(() => questions.filter((q) => q.active && q.answers.length > 0), [questions]);
  const matchAdvisors: MatchAdvisor[] = useMemo(
    () => advisors.map((a) => ({ id: a.id, name: a.name, priceDkk: a.priceDkk, active: true, tagIds: a.tagIds.filter((t) => activeTags.has(t)) })),
    [advisors, activeTags],
  );
  const answers: MatchAnswer[] = useMemo(
    () =>
      quiz.flatMap((q) =>
        q.answers
          .filter((a) => (picked[q.id] ?? []).includes(a.id))
          .map((a) => ({ boardSize: a.boardSize, tagWeights: a.weights.filter((w) => activeTags.has(w.tagId)) })),
      ),
    [quiz, picked, activeTags],
  );
  const result = useMemo(() => suggestBoard(matchAdvisors, answers), [matchAdvisors, answers]);
  const answered = quiz.filter((q) => (picked[q.id] ?? []).length > 0).length;
  const advisorName = (id: string) => advisors.find((a) => a.id === id)?.name ?? id;
  const maxNeed = Math.max(1, ...Object.values(result.needs));
  const needRows = Object.entries(result.needs).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const covered = new Set(result.coveredTagIds);

  const toggle = (q: CmsQuestion, id: string) =>
    setPicked((p) => {
      const cur = p[q.id] ?? [];
      if (q.type === "SINGLE") return { ...p, [q.id]: [id] };
      return { ...p, [q.id]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="preview-title"
      className="m-0 ml-auto h-full max-h-none w-full max-w-none border-0 bg-grey-bg p-0 text-ink backdrop:bg-overlay-navy lg:w-[min(1080px,92vw)]"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-grey-bg bg-white p-space-3 sm:px-space-4">
          <div>
            <span className="eyebrow !mb-2">Forhåndsvisning · intet gemmes</span>
            <h2 id="preview-title" className="text-xl font-light">Tag testen som en kunde</h2>
            <span className="rule-gold mt-3" aria-hidden="true" />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setPicked({})}>Nulstil</button>
            <button type="button" className="btn btn-sm" onClick={onClose}>Luk</button>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 lg:grid-cols-2">
          <div className="min-h-0 overflow-y-auto bg-white p-space-3 sm:p-space-4" data-testid="preview-questions">
            {quiz.length === 0 && <p className="text-sm text-muted">Der er ingen aktive spørgsmål at vise. Aktivér mindst ét spørgsmål med to svar.</p>}
            <ol className="space-y-space-4">
              {quiz.map((q, i) => (
                <li key={q.id}>
                  <fieldset>
                    <legend className="text-base font-semibold text-navy">
                      <span className="text-muted">{i + 1}. </span>{q.text}
                    </legend>
                    <p className="mb-2 text-xs text-muted">{q.type === "MULTI" ? "Vælg gerne flere" : "Vælg ét svar"}</p>
                    <div className="grid gap-1.5">
                      {q.answers.map((a) => {
                        const on = (picked[q.id] ?? []).includes(a.id);
                        return (
                          <label key={a.id} className={`flex cursor-pointer items-start gap-3 border px-3 py-2 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold-dark ${on ? "border-navy bg-grey-bg" : "border-slate bg-white hover:border-navy"}`}>
                            <input
                              type={q.type === "MULTI" ? "checkbox" : "radio"}
                              name={`pv-${q.id}`}
                              checked={on}
                              onChange={() => toggle(q, a.id)}
                              className="mt-1 h-4 w-4 shrink-0"
                            />
                            <span>{a.text}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                </li>
              ))}
            </ol>
          </div>

          <div className="min-h-0 overflow-y-auto p-space-3 sm:p-space-4" data-testid="preview-result" aria-live="polite">
            <p className="label">Foreslået board</p>
            <p className="text-sm text-muted">{answered} af {quiz.length} spørgsmål besvaret</p>
            {result.advisorIds.length === 0 ? (
              <p className="mt-3 border border-dashed border-slate bg-white p-space-3 text-sm text-muted">Ingen kvalificerede rådgivere (aktive, med mindst ét tag).</p>
            ) : (
              <>
                <ol className="mt-3 space-y-2">
                  {result.picks.map((p, i) => {
                    const reduced = p.effectiveScore < p.baseScore;
                    return (
                      <li key={p.advisorId} className="border border-grey-bg bg-white p-3 shadow-panel" data-testid="preview-pick">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-semibold text-navy"><span className="mr-2 text-muted">{i + 1}.</span>{advisorName(p.advisorId)}</p>
                          <p className="text-sm text-muted">{formatDkk(advisors.find((a) => a.id === p.advisorId)?.priceDkk ?? 0)} pr. møde</p>
                        </div>
                        <p className="mt-1 text-sm">
                          Score <span className="font-semibold text-navy" data-testid="pick-score">{p.effectiveScore}</span>
                          {reduced && <span className="text-muted"> (basis {p.baseScore}, nedskrevet fordi boardet allerede dækker nogle af tagsene)</span>}
                        </p>
                        <p className="mt-1 flex flex-wrap gap-1">
                          {p.matchedTagIds.length === 0 ? <span className="text-sm text-muted">Ingen matchende behov – fylder boardet op.</span> : null}
                          {p.matchedTagIds.map((t) => (
                            <span key={t} className={`badge ${p.newTagIds.includes(t) ? "badge-navy" : "badge-muted"}`} title={p.newTagIds.includes(t) ? "Nyt dækket behov" : "Allerede dækket af tidligere valg"}>
                              {tagName(t)} {result.needs[t]}
                            </span>
                          ))}
                        </p>
                      </li>
                    );
                  })}
                </ol>
                <p className="mt-3 text-sm text-muted">{SIZE_REASON[result.sizeReason]} Resultat: <strong className="text-navy">{result.size}</strong> rådgivere.</p>
              </>
            )}

            <div className="mt-space-4">
              <div className="flex items-baseline justify-between">
                <p className="label !mb-0">Kundens behov pr. tag</p>
                <p className="text-sm text-navy" data-testid="preview-coverage">Dækning {Math.round(result.coverage * 100)} %</p>
              </div>
              {needRows.length === 0 ? (
                <p className="mt-2 text-sm text-muted">Vælg svar for at se behovene.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {needRows.map(([t, n]) => (
                    <li key={t} className="grid grid-cols-[9.5rem_1fr_5.5rem] items-center gap-2 text-sm" data-testid="need-row" data-tag={tagName(t)}>
                      <span className="truncate text-ink">{tagName(t)}</span>
                      <span className="h-2 bg-white" role="presentation"><span className={`block h-2 ${covered.has(t) ? "bg-navy" : "bg-gold"}`} style={{ width: `${(n / maxNeed) * 100}%` }} /></span>
                      <span className="whitespace-nowrap text-right text-xs text-muted">{n} · {covered.has(t) ? "dækket" : "mangler"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-space-4">
              <p className="label">Score for alle rådgivere</p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Rådgiver</th><th className="text-right">Basescore</th><th className="text-right">Pris</th><th>I boardet</th></tr></thead>
                  <tbody>
                    {result.scores.map((s) => (
                      <tr key={s.advisorId}>
                        <td>{advisorName(s.advisorId)}</td>
                        <td className="text-right tabular-nums">{s.score}</td>
                        <td className="text-right tabular-nums">{formatDkk(advisors.find((a) => a.id === s.advisorId)?.priceDkk ?? 0)}</td>
                        <td>{result.advisorIds.includes(s.advisorId) ? <span className="badge badge-navy">Ja</span> : <span className="text-muted">–</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}
