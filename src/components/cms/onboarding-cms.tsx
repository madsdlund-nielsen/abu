"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createAnswerAction,
  createQuestionAction,
  deleteAnswerAction,
  deleteQuestionAction,
  reorderAnswersAction,
  reorderQuestionsAction,
  setAnswerWeightAction,
  updateAnswerAction,
  updateQuestionAction,
} from "@/app/actions/cms";
import type { CmsAdvisor, CmsAnswer, CmsQuestion, CmsTag } from "@/lib/onboarding/cms-types";
import { collectWarnings, type CmsWarning } from "@/lib/onboarding/warnings";
import { ConfirmDialog, SaveIndicator, Switch, useSaver, WarnBadge } from "./primitives";
import { PreviewDrawer } from "./preview-drawer";
import { SortableList } from "./sortable";

const DEFAULT_WEIGHT = 3;

export function OnboardingCms({ initialQuestions, tags, advisors }: { initialQuestions: CmsQuestion[]; tags: CmsTag[]; advisors: CmsAdvisor[] }) {
  const [questions, setQuestions] = useState(initialQuestions);
  const [selectedId, setSelectedId] = useState<string | null>(initialQuestions[0]?.id ?? null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CmsQuestion | null>(null);
  const saver = useSaver();
  const latest = useRef(questions);
  latest.current = questions;

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const warnings = useMemo(() => collectWarnings(questions, tags, advisors), [questions, tags, advisors]);
  const selected = questions.find((q) => q.id === selectedId) ?? null;

  /** Opdaterer straks i UI'et og ruller tilbage, hvis serveren afviser. */
  async function optimistic(update: (qs: CmsQuestion[]) => CmsQuestion[], call: () => Promise<{ ok: boolean }>) {
    const prev = latest.current;
    setQuestions(update(prev));
    const r = await saver.run(call);
    if (!r || !r.ok) setQuestions(prev);
    return r;
  }
  const patchQuestion = (id: string, patch: Partial<CmsQuestion>) => (qs: CmsQuestion[]) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q));
  const patchAnswer = (qid: string, aid: string, fn: (a: CmsAnswer) => CmsAnswer) => (qs: CmsQuestion[]) =>
    qs.map((q) => (q.id === qid ? { ...q, answers: q.answers.map((a) => (a.id === aid ? fn(a) : a)) } : q));

  async function addQuestion(text: string) {
    const r = await saver.run(() => createQuestionAction({ text, type: "SINGLE" }));
    if (r && r.ok && "id" in r) {
      const id = (r as { id: string }).id;
      setQuestions((qs) => [...qs, { id, text, helpText: "", type: "SINGLE", active: false, answers: [] }]);
      setSelectedId(id);
      setCreating(false);
    }
  }

  const warnCount = (q: CmsQuestion) => warnings.filter((w) => w.questionId === q.id).length;
  const activeCount = questions.filter((q) => q.active).length;

  return (
    <div>
      <div className="mb-space-4 flex flex-wrap items-start justify-between gap-3">
        <WarningSummary warnings={warnings} questions={questions} onSelect={setSelectedId} activeCount={activeCount} total={questions.length} />
        <div className="flex items-center gap-3">
          <SaveIndicator saver={saver} />
          <button type="button" className="btn" onClick={() => setPreviewOpen(true)}>
            Forhåndsvis test
          </button>
        </div>
      </div>

      <div className="grid items-start gap-space-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Venstre: spørgsmålsliste */}
        <section aria-labelledby="qlist" className="border border-grey-bg bg-white">
          <div className="border-b border-grey-bg px-4 py-3">
            <h2 id="qlist" className="!text-base !font-semibold">Spørgsmål</h2>
            <p className="text-xs text-muted">Træk i grebet (⋮⋮) for at ændre rækkefølgen, eller brug mellemrum og piletaster.</p>
          </div>
          {questions.length === 0 ? (
            <p className="p-space-4 text-sm text-muted">Der er ingen spørgsmål endnu. Opret det første, så starter kunderne med en test.</p>
          ) : (
            <SortableList
              items={questions}
              label="spørgsmål"
              itemLabel={(q) => q.text}
              className="divide-y divide-grey-bg"
              onReorder={(ids) =>
                optimistic(
                  (qs) => ids.map((id) => qs.find((q) => q.id === id)!),
                  () => reorderQuestionsAction(ids),
                )
              }
              renderItem={(q, { handle }) => {
                const n = questions.indexOf(q) + 1;
                const w = warnCount(q);
                const on = q.id === selectedId;
                return (
                  <div className={`flex items-stretch gap-1 pl-1 ${on ? "bg-grey-bg" : "bg-white"}`}>
                    <div className="flex items-center">{handle}</div>
                    <button
                      type="button"
                      onClick={() => setSelectedId(q.id)}
                      aria-current={on ? "true" : undefined}
                      className={`flex min-w-0 flex-1 flex-col gap-1 border-l-4 py-3 pl-3 pr-3 text-left ${on ? "border-gold" : "border-transparent hover:border-slate"}`}
                      data-testid="question-row"
                    >
                      <span className="line-clamp-2 text-sm font-semibold leading-snug text-navy">
                        <span className="mr-1 text-muted">{n}.</span>
                        {q.text}
                      </span>
                      <span className="flex flex-wrap items-center gap-1">
                        <span className={`badge ${q.active ? "badge-navy" : "badge-muted"}`}>{q.active ? "Aktiv" : "Inaktiv"}</span>
                        {q.type === "MULTI" && <span className="badge badge-outline">Flere svar</span>}
                        <span className="text-xs text-muted">{q.answers.length} svar</span>
                        <WarnBadge count={w} />
                      </span>
                    </button>
                  </div>
                );
              }}
            />
          )}
          <div className="border-t border-grey-bg p-3">
            {creating ? (
              <NewTextForm placeholder="Spørgsmålets tekst" submitLabel="Opret" onSubmit={addQuestion} onCancel={() => setCreating(false)} autoFocus />
            ) : (
              <button type="button" className="btn-secondary btn-sm w-full" onClick={() => setCreating(true)}>
                + Nyt spørgsmål
              </button>
            )}
          </div>
        </section>

        {/* Højre: redigering */}
        <section aria-live="off" className="min-w-0">
          {selected ? (
            <QuestionEditor
              key={selected.id}
              question={selected}
              index={questions.indexOf(selected) + 1}
              tags={tags}
              tagById={tagById}
              warnings={warnings}
              advisors={advisors}
              onPatch={(patch) => optimistic(patchQuestion(selected.id, patch), () => updateQuestionAction(selected.id, patch))}
              onAskDelete={() => setConfirmDelete(selected)}
              onAnswerPatch={(aid, patch) =>
                optimistic(
                  patchAnswer(selected.id, aid, (a) => ({ ...a, ...patch })),
                  () => updateAnswerAction(aid, patch),
                )
              }
              onWeight={(aid, tagId, weight) =>
                optimistic(
                  patchAnswer(selected.id, aid, (a) => ({
                    ...a,
                    weights:
                      weight === null
                        ? a.weights.filter((w) => w.tagId !== tagId)
                        : a.weights.some((w) => w.tagId === tagId)
                          ? a.weights.map((w) => (w.tagId === tagId ? { ...w, weight } : w))
                          : [...a.weights, { tagId, weight }],
                  })),
                  () => setAnswerWeightAction(aid, tagId, weight),
                )
              }
              onReorderAnswers={(ids) =>
                optimistic(
                  (qs) => qs.map((q) => (q.id === selected.id ? { ...q, answers: ids.map((id) => q.answers.find((a) => a.id === id)!) } : q)),
                  () => reorderAnswersAction(ids),
                )
              }
              onAddAnswer={async (text) => {
                const r = await saver.run(() => createAnswerAction(selected.id, { text }));
                if (r && r.ok && "id" in r) {
                  const id = (r as { id: string }).id;
                  setQuestions((qs) => qs.map((q) => (q.id === selected.id ? { ...q, answers: [...q.answers, { id, text, boardSize: null, weights: [] }] } : q)));
                }
              }}
              onDeleteAnswer={(aid) =>
                optimistic(
                  (qs) => qs.map((q) => (q.id === selected.id ? { ...q, answers: q.answers.filter((a) => a.id !== aid) } : q)),
                  () => deleteAnswerAction(aid),
                )
              }
            />
          ) : (
            <div className="border border-dashed border-slate bg-white p-space-5 text-center text-muted">
              {questions.length === 0 ? "Opret et spørgsmål for at komme i gang." : "Vælg et spørgsmål til venstre for at redigere det."}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Slet spørgsmålet permanent?"
        confirmLabel="Slet spørgsmål"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const q = confirmDelete;
          setConfirmDelete(null);
          if (!q) return;
          optimistic(
            (qs) => qs.filter((x) => x.id !== q.id),
            () => deleteQuestionAction(q.id),
          ).then((r) => {
            if (r?.ok) setSelectedId(latest.current[0]?.id ?? null);
          });
        }}
      >
        <p>
          «{confirmDelete?.text}» og dets {confirmDelete?.answers.length ?? 0} svar slettes. Kunder, der allerede har taget testen, beholder deres svar som
          snapshot. Vil du blot skjule spørgsmålet, så slå «Aktiv» fra i stedet.
        </p>
      </ConfirmDialog>

      <PreviewDrawer open={previewOpen} onClose={() => setPreviewOpen(false)} questions={questions} tags={tags} advisors={advisors} />
    </div>
  );
}

function WarningSummary({
  warnings,
  questions,
  onSelect,
  activeCount,
  total,
}: {
  warnings: CmsWarning[];
  questions: CmsQuestion[];
  onSelect: (id: string) => void;
  activeCount: number;
  total: number;
}) {
  if (warnings.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="warning-summary">
        <span className="font-semibold text-navy">Ingen advarsler.</span> {activeCount} af {total} spørgsmål er aktive.
      </p>
    );
  }
  return (
    <details className="max-w-2xl border-l-4 border-gold bg-white px-4 py-2 text-sm" data-testid="warning-summary">
      <summary className="font-semibold text-navy">
        {warnings.length} {warnings.length === 1 ? "advarsel" : "advarsler"}{" "}
        <span className="font-normal text-muted">· {activeCount} af {total} spørgsmål er aktive</span>
      </summary>
      <ul className="mt-2 space-y-1">
        {warnings.map((w, i) => {
          const q = questions.find((x) => x.id === w.questionId);
          return (
            <li key={`${w.scope}-${w.id}-${i}`}>
              {q ? (
                <button type="button" className="text-left underline underline-offset-2 hover:text-gold-dark" onClick={() => onSelect(q.id)}>
                  {w.message}
                </button>
              ) : (
                w.message
              )}
              {q && <span className="text-muted"> – «{q.text}»</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function NewTextForm({ placeholder, submitLabel, onSubmit, onCancel, autoFocus = false }: { placeholder: string; submitLabel: string; onSubmit: (t: string) => void | Promise<void>; onCancel?: () => void; autoFocus?: boolean }) {
  const [v, setV] = useState("");
  const submit = () => {
    const t = v.trim();
    if (!t) return;
    setV("");
    void onSubmit(t);
  };
  return (
    <div className="flex gap-2">
      <input
        className="input !py-1.5 text-sm"
        value={v}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          if (e.key === "Escape") onCancel?.();
        }}
      />
      <button type="button" className="btn btn-sm shrink-0" onClick={submit} disabled={!v.trim()}>{submitLabel}</button>
    </div>
  );
}

function QuestionEditor({
  question,
  index,
  tags,
  tagById,
  warnings,
  advisors,
  onPatch,
  onAskDelete,
  onAnswerPatch,
  onWeight,
  onReorderAnswers,
  onAddAnswer,
  onDeleteAnswer,
}: {
  question: CmsQuestion;
  index: number;
  tags: CmsTag[];
  tagById: Map<string, CmsTag>;
  warnings: CmsWarning[];
  advisors: CmsAdvisor[];
  onPatch: (p: Partial<CmsQuestion>) => void;
  onAskDelete: () => void;
  onAnswerPatch: (aid: string, p: Partial<CmsAnswer>) => void;
  onWeight: (aid: string, tagId: string, weight: number | null) => void;
  onReorderAnswers: (ids: string[]) => void;
  onAddAnswer: (text: string) => void;
  onDeleteAnswer: (aid: string) => void;
}) {
  const [text, setText] = useState(question.text);
  const [help, setHelp] = useState(question.helpText);
  const [confirmAnswer, setConfirmAnswer] = useState<CmsAnswer | null>(null);
  const qWarnings = warnings.filter((w) => w.scope === "question" && w.id === question.id);
  const advisorTagIds = useMemo(() => new Set(advisors.flatMap((a) => a.tagIds)), [advisors]);

  return (
    <div className="border border-grey-bg bg-white p-space-3 sm:p-space-4">
      <span className="eyebrow">Spørgsmål {index}</span>
      <h2 className="text-xl font-light">Rediger spørgsmål</h2>
      <span className="rule-gold mt-3" aria-hidden="true" />

      {qWarnings.map((w) => (
        <p key={w.message} className="callout mt-space-3 text-sm" role="note">{w.message}</p>
      ))}

      <div className="mt-space-4 grid gap-4">
        <div>
          <label className="label" htmlFor="q-text">Spørgsmål</label>
          <input
            id="q-text"
            className="input"
            value={text}
            maxLength={300}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text.trim() && text.trim() !== question.text && onPatch({ text: text.trim() })}
          />
        </div>
        <div>
          <label className="label" htmlFor="q-help">Hjælpetekst (valgfri)</label>
          <input
            id="q-help"
            className="input"
            value={help}
            maxLength={500}
            onChange={(e) => setHelp(e.target.value)}
            onBlur={() => help.trim() !== question.helpText && onPatch({ helpText: help.trim() })}
          />
        </div>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <fieldset>
            <legend className="label">Type</legend>
            <div className="inline-flex" role="radiogroup" aria-label="Type">
              {(["SINGLE", "MULTI"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={question.type === t}
                  onClick={() => question.type !== t && onPatch({ type: t })}
                  className={`border px-4 py-2 text-xs font-bold uppercase tracking-wide first:border-r-0 ${
                    question.type === t ? "border-navy bg-navy text-white" : "border-slate bg-white text-navy hover:border-navy"
                  }`}
                >
                  {t === "SINGLE" ? "Ét svar" : "Flere svar"}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex items-center gap-3">
            <Switch checked={question.active} onChange={(v) => onPatch({ active: v })} label="Aktiv i testen" />
            <span className="text-sm">
              <span className="font-semibold text-navy">{question.active ? "Aktiv" : "Inaktiv"}</span>{" "}
              <span className="text-muted">{question.active ? "– vises for nye kunder" : "– skjult for kunder"}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-space-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3>Svar</h3>
          <span className="text-xs text-muted">Vægt 1-5 pr. tag. Træk i grebet for at sortere.</span>
        </div>
        {question.answers.length === 0 ? (
          <p className="mt-3 border border-dashed border-slate p-space-3 text-sm text-muted">Spørgsmålet har ingen svar endnu. Tilføj mindst to herunder.</p>
        ) : (
          <SortableList
            items={question.answers}
            label="svar"
            itemLabel={(a) => a.text}
            onReorder={onReorderAnswers}
            className="mt-3 space-y-2"
            renderItem={(a, { handle }) => (
              <AnswerRow
                answer={a}
                handle={handle}
                tags={tags}
                tagById={tagById}
                advisorTagIds={advisorTagIds}
                warnings={warnings.filter((w) => w.scope === "answer" && w.id === a.id)}
                onPatch={(p) => onAnswerPatch(a.id, p)}
                onWeight={(tagId, weight) => onWeight(a.id, tagId, weight)}
                onAskDelete={() => setConfirmAnswer(a)}
              />
            )}
          />
        )}
        <div className="mt-3">
          <NewTextForm placeholder="Nyt svar – skriv og tryk Enter" submitLabel="Tilføj svar" onSubmit={onAddAnswer} />
        </div>
      </div>

      <div className="mt-space-5 flex flex-wrap items-center justify-between gap-3 border-t border-grey-bg pt-space-3">
        <p className="text-xs text-muted">Ændringer gælder straks for nye kunder. Gennemførte tests beholder deres svar som snapshot.</p>
        <button type="button" className="btn-danger btn-sm" onClick={onAskDelete}>Slet spørgsmål</button>
      </div>

      <ConfirmDialog
        open={confirmAnswer !== null}
        title="Slet svaret?"
        confirmLabel="Slet svar"
        onCancel={() => setConfirmAnswer(null)}
        onConfirm={() => {
          const a = confirmAnswer;
          setConfirmAnswer(null);
          if (a) onDeleteAnswer(a.id);
        }}
      >
        <p>«{confirmAnswer?.text}» og dets tag-vægte slettes.</p>
      </ConfirmDialog>
    </div>
  );
}

function AnswerRow({
  answer,
  handle,
  tags,
  tagById,
  advisorTagIds,
  warnings,
  onPatch,
  onWeight,
  onAskDelete,
}: {
  answer: CmsAnswer;
  handle: React.ReactNode;
  tags: CmsTag[];
  tagById: Map<string, CmsTag>;
  advisorTagIds: Set<string>;
  warnings: CmsWarning[];
  onPatch: (p: Partial<CmsAnswer>) => void;
  onWeight: (tagId: string, weight: number | null) => void;
  onAskDelete: () => void;
}) {
  const [text, setText] = useState(answer.text);
  const used = new Set(answer.weights.map((w) => w.tagId));
  return (
    <div className="flex gap-1 border border-slate/50 bg-white p-2 sm:p-3" data-testid="answer-row" data-answer={answer.text}>
      <div className="pt-1">{handle}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-2">
          <input
            className="input min-w-[12rem] flex-1 !py-1.5 text-sm"
            value={text}
            maxLength={300}
            aria-label="Svartekst"
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text.trim() && text.trim() !== answer.text && onPatch({ text: text.trim() })}
          />
          <label className="flex items-center gap-2 text-xs text-muted">
            <span className="font-bold uppercase tracking-wide text-navy">Board</span>
            <select
              className="input !w-auto !py-1.5 text-sm"
              aria-label="Boardstørrelse som dette svar angiver"
              value={answer.boardSize ?? ""}
              onChange={(e) => onPatch({ boardSize: e.target.value === "" ? null : Number(e.target.value) })}
            >
              <option value="">Ingen størrelse</option>
              <option value="2">2 rådgivere</option>
              <option value="3">3 rådgivere</option>
              <option value="4">4 rådgivere</option>
            </select>
          </label>
          <button type="button" className="px-2 py-1 text-sm text-muted hover:text-danger focus-visible:text-danger" onClick={onAskDelete} aria-label={`Slet svaret «${answer.text}»`}>
            Slet
          </button>
        </div>

        <ul className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Tag-vægte">
          {answer.weights.map((w) => {
            const tag = tagById.get(w.tagId);
            if (!tag) return null;
            const uncoverable = tag.active && !advisorTagIds.has(tag.id);
            return (
              <li key={w.tagId} className="inline-flex items-stretch border border-slate bg-white text-xs" data-testid="weight-chip" data-tag={tag.name}>
                <span
                  className={`flex items-center px-2 py-1 font-semibold ${tag.active ? "text-navy" : "text-muted line-through"}`}
                  title={uncoverable ? "Ingen aktive rådgivere har dette tag" : !tag.active ? "Tagget er deaktiveret" : undefined}
                >
                  {tag.name}
                  {(uncoverable || !tag.active) && <span className="ml-1 text-gold-dark" aria-label="Advarsel">!</span>}
                </span>
                <span role="radiogroup" aria-label={`Vægt for ${tag.name}`} className="flex items-center gap-[3px] border-l border-slate/50 px-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={w.weight === n}
                      aria-label={`Vægt ${n}`}
                      onClick={() => w.weight !== n && onWeight(tag.id, n)}
                      className={`h-4 w-3 border transition-colors ${n <= w.weight ? "border-navy bg-navy" : "border-slate bg-white hover:border-navy"}`}
                    />
                  ))}
                  <span className="ml-1 w-2 text-center tabular-nums text-muted" aria-hidden="true">{w.weight}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onWeight(tag.id, null)}
                  aria-label={`Fjern ${tag.name}`}
                  className="border-l border-slate/50 px-2 text-muted hover:text-danger focus-visible:text-danger"
                >
                  ×
                </button>
              </li>
            );
          })}
          <li>
            <TagPicker tags={tags.filter((t) => t.active && !used.has(t.id))} onPick={(id) => onWeight(id, DEFAULT_WEIGHT)} />
          </li>
        </ul>
        {warnings.map((w) => (
          <p key={w.message} className="mt-2 text-xs font-semibold text-gold-dark" role="note">
            <span aria-hidden="true">! </span>{w.message}
          </p>
        ))}
      </div>
    </div>
  );
}

function TagPicker({ tags, onPick }: { tags: CmsTag[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const rows = tags.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        className="border border-dashed border-slate px-2 py-1 text-xs font-bold uppercase tracking-wide text-navy hover:border-navy"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => { setOpen((o) => !o); setQ(""); }}
      >
        + tag
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 border border-slate bg-white p-2 shadow-panel">
          <input className="input !py-1.5 text-sm" placeholder="Søg tag" aria-label="Søg tag" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <ul className="mt-2 max-h-56 overflow-y-auto" role="listbox" aria-label="Tags">
            {rows.length === 0 && <li className="px-2 py-2 text-xs text-muted">Ingen tags at tilføje.</li>}
            {rows.map((t) => (
              <li key={t.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm hover:bg-grey-bg focus-visible:bg-grey-bg"
                  onClick={() => { onPick(t.id); setOpen(false); }}
                >
                  <span>{t.name}</span>
                  {t.advisors === 0 && <span className="text-xs text-gold-dark" title="Ingen aktive rådgivere har dette tag">0 rådgivere</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
