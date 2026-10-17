"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { addAdvisorAction, cancelOnBehalfAction, removeAdvisorAction, replaceAdvisorAction, rescheduleMeetingAction } from "@/app/actions/admin-meetings";
import { DateTimeField } from "@/components/date-time-field";
import { ConfirmDialog, SaveIndicator, useSaver } from "@/components/cms/primitives";
import { Initials } from "@/components/ui";
import { formatDkk } from "@/lib/pricing";
import type { RankedCandidate } from "@/lib/substitutes";

export interface PanelAdvisor {
  id: string;
  name: string;
  title: string;
  priceDkk: number | null;
}

export interface PanelProps {
  meetingId: string;
  editable: boolean;
  advisors: PanelAdvisor[];
  boardSize: number;
  candidates: RankedCandidate[];
  tagNames: Record<string, string>;
  startsLabel: string;
  defaultDate: string;
  defaultTime: string;
  canCancel: boolean;
}

type Picker = { kind: "replace"; target: PanelAdvisor } | { kind: "add" };

export function MeetingAdminPanel(props: PanelProps) {
  const { meetingId, editable, advisors, boardSize, candidates, tagNames } = props;
  const router = useRouter();
  const saver = useSaver();
  const [picker, setPicker] = useState<Picker | null>(null);
  const [removing, setRemoving] = useState<PanelAdvisor | null>(null);
  const [moving, setMoving] = useState<{ date: string; time: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const below = advisors.length < boardSize;

  async function exec(call: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    setResult(null);
    const r = await saver.run(call);
    if (r && r.ok) {
      setResult({ ok: true, text: r.message });
      setNote("");
      router.refresh();
    } else {
      setResult({ ok: false, text: r && !r.ok ? r.error : "Ændringen kunne ikke gennemføres." });
    }
    return r;
  }

  return (
    <div className="space-y-space-4">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <div role="status" aria-live="polite" className="min-w-0 flex-1">
          {result && (
            <p className={`callout text-sm ${result.ok ? "" : "callout-error"}`} role={result.ok ? "status" : "alert"} data-testid={result.ok ? "admin-result-ok" : "admin-result-err"}>
              {result.text}
            </p>
          )}
        </div>
        <SaveIndicator saver={saver} />
      </div>

      <section className="card" aria-labelledby="deltagere-h">
        <span className="eyebrow">Deltagere</span>
        <h2 id="deltagere-h" className="text-xl font-light">Rådgivere i mødet</h2>
        <span className="rule-gold mt-3" aria-hidden="true" />
        {below && (
          <p className="callout mt-space-3 text-sm" role="note" data-testid="below-board">
            Der er {advisors.length} {advisors.length === 1 ? "rådgiver" : "rådgivere"} i mødet, men kundens board har {boardSize}. Kunden betaler for hele boardet.
          </p>
        )}
        <ul className="mt-space-3 divide-y divide-grey-bg" data-testid="participants">
          {advisors.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-3" data-advisor={a.name}>
              <Initials name={a.name} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-navy">{a.name}</p>
                <p className="text-sm text-muted">{a.title}{a.priceDkk !== null && ` · honorar-grundlag ${formatDkk(a.priceDkk)}`}</p>
              </div>
              {editable && (
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setPicker({ kind: "replace", target: a })} aria-label={`Udskift ${a.name}`}>Udskift</button>
                  <button type="button" className="btn-danger btn-sm" onClick={() => setRemoving(a)} disabled={advisors.length <= 1} title={advisors.length <= 1 ? "Et møde skal have mindst én rådgiver" : undefined} aria-label={`Fjern ${a.name}`}>Fjern</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <div className="mt-space-3">
            <button type="button" className="btn-secondary" onClick={() => setPicker({ kind: "add" })}>Tilføj ekstra deltager</button>
          </div>
        )}
        <p className="mt-space-3 text-xs text-muted">Kundens pris er uændret, fordi abonnementet dækker mødet. Honoraret følger de faktiske deltagere.</p>
      </section>

      {editable && (
        <section className="card" aria-labelledby="flyt-h">
          <span className="eyebrow">Tidspunkt</span>
          <h2 id="flyt-h" className="text-xl font-light">Flyt mødet</h2>
          <span className="rule-gold mt-3" aria-hidden="true" />
          <p className="mt-space-3 text-sm text-muted">Nu: <span className="font-semibold text-navy first-letter:uppercase">{props.startsLabel}</span>. Alle rådgivere skal være ledige på det nye tidspunkt.</p>
          <form
            className="mt-space-3 grid max-w-md gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setMoving({ date: String(f.get("newDate") ?? ""), time: String(f.get("newTime") ?? "") });
            }}
          >
            <DateTimeField name="new" label="Nyt tidspunkt" defaultDate={props.defaultDate} defaultTime={props.defaultTime} />
            <div><button className="btn-secondary" type="submit">Flyt mødet …</button></div>
          </form>
        </section>
      )}

      {editable && props.canCancel && (
        <section className="card" aria-labelledby="aflys-h">
          <span className="eyebrow">Aflys</span>
          <h2 id="aflys-h" className="text-xl font-light">Aflys på kundens vegne</h2>
          <span className="rule-gold mt-3" aria-hidden="true" />
          <p className="mt-space-3 text-sm text-muted">Kunden og rådgiverne underrettes. Aflysning mindst 48 timer før start frigiver kvoten.</p>
          <div className="mt-space-3"><button className="btn-danger" type="button" onClick={() => setCancelling(true)}>Aflys mødet …</button></div>
        </section>
      )}

      {picker && (
        <CandidateDialog
          picker={picker}
          candidates={candidates}
          tagNames={tagNames}
          note={note}
          setNote={setNote}
          onClose={() => setPicker(null)}
          onConfirm={async (c) => {
            const p = picker;
            setPicker(null);
            await exec(() => (p.kind === "replace" ? replaceAdvisorAction(meetingId, p.target.id, c.id, note) : addAdvisorAction(meetingId, c.id, note)));
          }}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        title={`Fjern ${removing?.name ?? ""} fra mødet?`}
        confirmLabel="Fjern rådgiver"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const r = removing;
          setRemoving(null);
          if (r) await exec(() => removeAdvisorAction(meetingId, r.id, note));
        }}
      >
        <p>{removing?.name} får besked om, at vedkommende er udgået af mødet. {advisors.length - 1 < boardSize && `Mødet får så ${advisors.length - 1} ${advisors.length - 1 === 1 ? "rådgiver" : "rådgivere"}, og det er færre end kundens board (${boardSize}).`}</p>
        <NoteField note={note} setNote={setNote} />
      </ConfirmDialog>

      <ConfirmDialog
        open={moving !== null}
        title="Flyt mødet?"
        confirmLabel="Flyt mødet"
        danger={false}
        onCancel={() => setMoving(null)}
        onConfirm={async () => {
          const m = moving;
          setMoving(null);
          if (m) await exec(() => rescheduleMeetingAction(meetingId, m.date, m.time, note));
        }}
      >
        <p>Mødet flyttes til <span className="font-semibold text-navy">{moving?.date} kl. {moving?.time}</span>. Deltagerne underrettes, og påmindelserne planlægges igen.</p>
        <NoteField note={note} setNote={setNote} />
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelling}
        title="Aflys mødet på kundens vegne?"
        confirmLabel="Aflys mødet"
        onCancel={() => setCancelling(false)}
        onConfirm={async () => {
          setCancelling(false);
          await exec(() => cancelOnBehalfAction(meetingId, note));
        }}
      >
        <p>Kunden og alle rådgivere underrettes, og planlagte påmindelser annulleres.</p>
        <NoteField note={note} setNote={setNote} />
      </ConfirmDialog>
    </div>
  );
}

function NoteField({ note, setNote }: { note: string; setNote: (v: string) => void }) {
  return (
    <div className="mt-3">
      <label className="label" htmlFor="admin-note">Intern note (valgfri)</label>
      <input id="admin-note" className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Fx «Frafald pga. sygdom»" />
      <p className="mt-1 text-xs text-muted">Gemmes kun i historikken. Kunden ser den ikke.</p>
    </div>
  );
}

function CandidateDialog({
  picker,
  candidates,
  tagNames,
  note,
  setNote,
  onClose,
  onConfirm,
}: {
  picker: Picker;
  candidates: RankedCandidate[];
  tagNames: Record<string, string>;
  note: string;
  setNote: (v: string) => void;
  onClose: () => void;
  onConfirm: (c: RankedCandidate) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [chosen, setChosen] = useState<RankedCandidate | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return candidates.filter((c) => !needle || `${c.name} ${c.title}`.toLowerCase().includes(needle));
  }, [candidates, q]);
  const title = picker.kind === "replace" ? `Udskift ${picker.target.name}` : "Tilføj ekstra deltager";

  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      aria-labelledby="cand-title"
      className="m-0 ml-auto h-full max-h-none w-full max-w-xl border-0 bg-white p-0 text-ink backdrop:bg-overlay-navy sm:m-auto sm:h-[min(90vh,820px)] sm:border sm:border-grey-bg"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-grey-bg p-space-3 sm:p-space-4">
          <div>
            <span className="eyebrow !mb-2">Kandidater</span>
            <h2 id="cand-title" className="text-xl font-light">{title}</h2>
            <span className="rule-gold mt-3" aria-hidden="true" />
            <p className="mt-2 text-xs text-muted">Sorteret efter ledighed på mødets tidspunkt, match med kundens behov og pris.</p>
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Luk</button>
        </div>
        {chosen ? (
          <div className="flex-1 overflow-y-auto p-space-3 sm:p-space-4" data-testid="candidate-confirm">
            <p className="text-sm">
              {picker.kind === "replace" ? (
                <>Udskift <span className="font-semibold text-navy">{picker.target.name}</span> med <span className="font-semibold text-navy">{chosen.name}</span> i dette ene møde?</>
              ) : (
                <>Tilføj <span className="font-semibold text-navy">{chosen.name}</span> som ekstra deltager i mødet?</>
              )}{" "}
              Kunden og de berørte rådgivere underrettes. Den nye rådgiver får værtsadgang til det eksisterende videorum.
            </p>
            <NoteField note={note} setNote={setNote} />
            <div className="mt-space-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setChosen(null)}>Tilbage</button>
              <button type="button" className="btn btn-sm" onClick={() => onConfirm(chosen)} data-testid="confirm-candidate">
                {picker.kind === "replace" ? "Udskift rådgiver" : "Tilføj deltager"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-grey-bg p-space-3 sm:px-space-4">
              <label className="label" htmlFor="cand-search">Søg</label>
              <input id="cand-search" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Navn eller titel" autoFocus />
            </div>
            <ul className="flex-1 divide-y divide-grey-bg overflow-y-auto" data-testid="candidates">
              {rows.length === 0 && <li className="p-space-4 text-center text-muted">Ingen aktive rådgivere at vælge.</li>}
              {rows.map((c, i) => (
                <li key={c.id} className={`flex gap-3 p-space-3 sm:px-space-4 ${c.available ? "" : "bg-grey-bg/60"}`} data-candidate={c.name} data-available={c.available}>
                  <Initials name={c.name} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-snug text-navy">
                      {c.name}
                      {c.available && i === 0 && c.score > 0 && <span className="badge badge-gold ml-2 align-middle">Bedste match</span>}
                    </p>
                    <p className="text-sm text-muted">{c.title}</p>
                    <p className="mt-1">
                      {c.available ? <span className="badge badge-navy">Ledig</span> : <span className="badge badge-muted">Optaget · {c.conflict}</span>}
                    </p>
                    {c.tagIds.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1" aria-label="Kompetencer">
                        {c.tagIds.map((t) => (
                          <li key={t} className={`badge ${c.matchedTagIds.includes(t) ? "badge-navy" : "badge-muted"}`}>{tagNames[t] ?? t}</li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-sm"><span className="font-semibold text-navy">{formatDkk(c.priceDkk)}</span> <span className="text-muted">pr. møde · match {c.score}</span></p>
                  </div>
                  <button type="button" className="btn btn-sm self-center" disabled={!c.available} onClick={() => setChosen(c)} aria-label={`Vælg ${c.name}`}>Vælg</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </dialog>
  );
}
