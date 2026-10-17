"use client";

import { createContext, useContext, useMemo, useRef, useState } from "react";
import { resetTextAction, saveTextAction } from "@/app/actions/content";
import { Rich } from "@/components/rich";
import { DEFAULTS, interpolate, STEP_GROUPS, TEXT_DEFS, validateText, type TextDef } from "@/lib/content/onboarding-texts";
import { SaveIndicator, useSaver } from "./primitives";

const SAMPLE_VARS: Record<string, string | number> = {
  n: 3,
  total: 6,
  trin: "Bekræft",
  cvr: "30000102",
  navn: "Demo ApS",
  status: "Ophørt",
  antal: 3,
  min: 10,
};

export function OnboardingTextsCms({ initialValues, initialVersions }: { initialValues: Record<string, string>; initialVersions: Record<string, number> }) {
  const [values, setValues] = useState(initialValues);
  const [versions, setVersions] = useState(initialVersions);
  const [step, setStep] = useState(1);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const saver = useSaver();

  const defs = useMemo(() => TEXT_DEFS.filter((d) => d.step === step), [step]);
  const changed = (d: TextDef) => values[d.key] !== d.default;
  const countFor = (s: number) => TEXT_DEFS.filter((d) => d.step === s && values[d.key] !== d.default).length;

  async function save(def: TextDef, next: string) {
    const prev = values[def.key];
    const r = await saver.run(() => saveTextAction(def.key, next));
    if (r && r.ok) {
      setValues((v) => ({ ...v, [def.key]: r.value }));
      setVersions((v) => ({ ...v, [def.key]: r.version }));
    } else {
      setValues((v) => ({ ...v, [def.key]: prev }));
    }
    return r;
  }

  async function reset(def: TextDef) {
    const prev = values[def.key];
    setValues((v) => ({ ...v, [def.key]: def.default })); // optimistisk
    const r = await saver.run(() => resetTextAction(def.key));
    if (r && r.ok) setVersions((v) => ({ ...v, [def.key]: r.version }));
    else setValues((v) => ({ ...v, [def.key]: prev }));
  }

  return (
    <div>
      <div className="mb-space-3 flex items-center justify-end"><SaveIndicator saver={saver} /></div>
      <div className="grid items-start gap-space-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_380px]">
        <nav aria-label="Trin" className="min-w-0 border border-grey-bg bg-white lg:sticky lg:top-6">
          <ul className="flex overflow-x-auto lg:block lg:divide-y lg:divide-grey-bg">
            {STEP_GROUPS.map((g) => {
              const on = g.step === step;
              const n = countFor(g.step);
              return (
                <li key={g.step} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    onClick={() => setStep(g.step)}
                    aria-current={on ? "true" : undefined}
                    data-testid={`step-tab-${g.step}`}
                    className={`flex w-full items-center justify-between gap-3 border-b-4 px-4 py-3 text-left text-sm lg:border-b-0 lg:border-l-4 ${on ? "border-gold bg-grey-bg font-semibold text-navy" : "border-transparent text-ink hover:border-slate"}`}
                  >
                    <span className="whitespace-nowrap">{g.title}</span>
                    {n > 0 && <span className="badge badge-gold">{n}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="min-w-0 border border-grey-bg bg-white p-space-3 sm:p-space-4" aria-label={STEP_GROUPS[step].title}>
          <span className="eyebrow">{step === 0 ? "Fælles" : `Trin ${step}`}</span>
          <h2 className="text-xl font-light">{STEP_GROUPS[step].title}</h2>
          <span className="rule-gold mt-3" aria-hidden="true" />
          <div className="mt-space-4 grid gap-space-4">
            {defs.map((d) => (
              <TextField
                key={`${d.key}:${values[d.key] === d.default ? "d" : "c"}:${versions[d.key] ?? 0}`}
                def={d}
                value={values[d.key]}
                version={versions[d.key] ?? 0}
                customized={changed(d)}
                onFocus={() => setFocusKey(d.key)}
                onSave={(v) => save(d, v)}
                onReset={() => reset(d)}
              />
            ))}
          </div>
        </section>

        <aside className="min-w-0 lg:col-span-2 xl:sticky xl:top-6 xl:col-span-1" aria-label="Forhåndsvisning">
          <div className="border border-grey-bg bg-white">
            <div className="border-b border-grey-bg px-4 py-3">
              <h2 className="!text-base !font-semibold">Forhåndsvisning</h2>
              <p className="text-xs text-muted">Sådan ser trinnet ud for kunden. Feltet, du redigerer, er markeret med guld.</p>
            </div>
            <div className="bg-grey-bg p-3">
              <StepPreview step={step} values={values} focusKey={focusKey} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TextField({
  def,
  value,
  version,
  customized,
  onFocus,
  onSave,
  onReset,
}: {
  def: TextDef;
  value: string;
  version: number;
  customized: boolean;
  onFocus: () => void;
  onSave: (v: string) => Promise<unknown>;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const id = `t-${def.key}`;
  const problem = validateText(def, draft);
  const dirty = draft.trim() !== value;

  const insert = (name: string) => {
    const el = ref.current;
    const token = `{${name}}`;
    if (!el) return setDraft((d) => d + token);
    const s = el.selectionStart ?? draft.length;
    const e = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, s) + token + draft.slice(e);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  };

  const commit = () => {
    if (!dirty || problem) return;
    void onSave(draft);
  };

  const Field = def.multiline ? "textarea" : "input";
  return (
    <div data-testid="text-field" data-key={def.key}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label className="label !mb-0" htmlFor={id}>{def.label}</label>
        <span className="flex items-center gap-2">
          {def.consent && <span className="badge badge-outline">Samtykke · version {version}</span>}
          <span className={`badge ${customized ? "badge-gold" : "badge-muted"}`}>{customized ? "Ændret" : "Standard"}</span>
        </span>
      </div>
      {def.hint && <p className="mt-1 text-xs text-muted">{def.hint}</p>}
      <Field
        ref={ref as never}
        id={id}
        className={`input mt-1 ${def.multiline ? "min-h-24" : ""} ${problem ? "!border-danger" : ""}`}
        value={draft}
        maxLength={(def.max ?? 500) + 50}
        rows={def.multiline ? 4 : undefined}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-err` : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={onFocus}
        onBlur={commit}
      />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1" aria-label="Pladsholdere">
          {def.vars?.map((v) => (
            <button key={v} type="button" onClick={() => insert(v)} className="badge badge-muted cursor-pointer normal-case tracking-normal hover:border-navy" title={`Indsæt {${v}}`}>
              {`{${v}}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="tabular-nums">{draft.trim().length}/{def.max ?? 500}</span>
          <button type="button" className="underline disabled:no-underline disabled:opacity-40" disabled={!customized && !dirty} onClick={() => { setDraft(def.default); onReset(); }}>
            Gendan standard
          </button>
        </div>
      </div>
      {problem && <p id={`${id}-err`} role="alert" className="mt-1 text-xs font-semibold text-danger">{problem}</p>}
      {def.consent && dirty && !problem && (
        <p className="callout mt-2 text-xs" role="note">Når du forlader feltet, gemmes en ny version af samtykketeksten. Eksisterende samtykker beholder den tekst, de blev givet på.</p>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- Forhåndsvisning

// Små byggesten til forhåndsvisningen. De ligger uden for StepPreview (React må ikke oprette komponenter under render)
// og henter tekster/fremhævning fra en kontekst.
interface PreviewApi {
  t: (k: string) => string;
  hit: (...keys: string[]) => string;
  values: Record<string, string>;
  labels: string[];
  eyebrow: string;
}
const PreviewCtx = createContext<PreviewApi>({ t: (k) => k, hit: () => "", values: {}, labels: [], eyebrow: "" });

function Btn({ k, secondary }: { k: string; secondary?: boolean }) {
  const { t, hit } = useContext(PreviewCtx);
  return <span className={`${secondary ? "btn-secondary" : "btn"} btn-sm pointer-events-none ${hit(k)}`}>{t(k)}</span>;
}
function PField({ k, ph }: { k: string; ph?: string }) {
  const { t, hit } = useContext(PreviewCtx);
  return (
    <div>
      <p className={`label ${hit(k)}`}>{t(k)}</p>
      <div className="input text-sm text-muted">{ph ? <span className={hit(ph)}>{t(ph)}</span> : " "}</div>
    </div>
  );
}
function R({ k, className = "" }: { k: string; className?: string }) {
  const { hit, values } = useContext(PreviewCtx);
  return <span className={`block ${className} ${hit(k)}`}><Rich text={interpolate(values[k] ?? DEFAULTS[k], SAMPLE_VARS)} /></span>;
}
function Box({ children }: { children: React.ReactNode }) {
  return <div className="panel !p-4">{children}</div>;
}
function Head({ titleKey }: { titleKey: string }) {
  const { t, hit, labels, eyebrow } = useContext(PreviewCtx);
  return (
    <>
      <span className={`eyebrow ${hit("common.eyebrow", ...labels.map((_, i) => `common.stepLabel${i + 1}`))}`}>{eyebrow}</span>
      <p className={`mb-3 text-2xl font-light leading-snug text-navy ${hit(titleKey)}`}>{t(titleKey)}</p>
    </>
  );
}

function StepPreview({ step, values, focusKey }: { step: number; values: Record<string, string>; focusKey: string | null }) {
  const t = (k: string) => interpolate(values[k] ?? DEFAULTS[k] ?? k, SAMPLE_VARS);
  const hit = (...keys: string[]) => (focusKey && keys.includes(focusKey) ? "outline outline-2 outline-offset-2 outline-gold-dark" : "");
  const labels = [1, 2, 3, 4, 5, 6].map((n) => values[`common.stepLabel${n}`] ?? DEFAULTS[`common.stepLabel${n}`]);
  const shown = step === 0 ? 1 : step;
  const eyebrow = interpolate(values["common.eyebrow"] ?? DEFAULTS["common.eyebrow"], { n: shown, total: 6, trin: labels[shown - 1] });

  return (
    <PreviewCtx.Provider value={{ t, hit, values, labels, eyebrow }}>
    <div className="text-sm">
      {step === 0 && (
        <div>
          <Head titleKey="step1.title" />
          <Box>
            <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs uppercase tracking-wide text-muted" aria-label="Trinnavne">
              {labels.map((l, i) => <li key={i} className={hit(`common.stepLabel${i + 1}`)}>{i + 1}. {l}</li>)}
            </ol>
            <div className="mt-4 flex justify-between gap-2"><Btn k="common.back" secondary /><Btn k="common.next" /></div>
            <p className={`callout callout-error mt-4 text-xs ${hit("error.tooMany")}`}>{t("error.tooMany")}</p>
            <p className={`callout callout-error mt-2 text-xs ${hit("error.accountExists")}`}>{t("error.accountExists")} Log ind her, eller brug en anden e-mail.</p>
          </Box>
        </div>
      )}
      {step === 1 && (
        <div>
          <Head titleKey="step1.title" />
          <Box>
            <p className={`mb-3 text-muted ${hit("step1.intro")}`}>{t("step1.intro")}</p>
            <div className="grid gap-3">
              <PField k="step1.nameLabel" />
              <PField k="step1.emailLabel" />
              <div className="flex items-start gap-2 text-xs text-muted">
                <span className="mt-0.5 h-4 w-4 shrink-0 border border-slate bg-white" aria-hidden="true" />
                <R k="step1.consent" />
              </div>
              <div className="flex items-center justify-between gap-2"><span className={`text-xs text-muted ${hit("step1.loginHint")}`}><Rich text={t("step1.loginHint")} /></span><Btn k="step1.submit" /></div>
            </div>
          </Box>
        </div>
      )}
      {step === 2 && (
        <div>
          <Head titleKey="step2.title" />
          <Box>
            <p className={`mb-3 text-muted ${hit("step2.intro")}`}>{t("step2.intro")}</p>
            <div className="grid gap-3">
              <PField k="step2.cvrLabel" ph="step2.cvrPlaceholder" />
              <PField k="step2.phoneLabel" ph="step2.phonePlaceholder" />
              <div className="flex justify-between"><Btn k="common.back" secondary /><Btn k="step2.submit" /></div>
            </div>
          </Box>
        </div>
      )}
      {step === 3 && (
        <div className="grid gap-3">
          <Head titleKey="step3.title" />
          <Box>
            <p className="label">CVR 30000102</p>
            <p className="mt-2 font-semibold text-navy">Demo ApS · Testvej 1, København Ø</p>
            <p className={`mt-2 text-xs text-muted ${hit("step3.source")}`}>{t("step3.source")}</p>
            <div className="mt-3 flex justify-between gap-2"><Btn k="common.back" secondary /><Btn k="step3.confirm" /></div>
            <p className={`mt-2 text-xs ${hit("step3.wrong")}`}><u>{t("step3.wrong")}</u></p>
          </Box>
          <Box>
            <div role="note" className="callout callout-error text-xs">
              <p className={`font-semibold ${hit("step3.ceasedTitle")}`}>{t("step3.ceasedTitle")}</p>
              <p className={hit("step3.ceasedBody")}>{t("step3.ceasedBody")}</p>
            </div>
          </Box>
          <Box>
            <div role="note" className="callout callout-error text-xs">
              <p className={`font-semibold ${hit("step3.notFoundTitle", "step3.errorTitle")}`}>{t("step3.notFoundTitle")}</p>
              <p className={hit("step3.notFoundBody")}>{t("step3.notFoundBody")}</p>
              <p className={`mt-1 ${hit("step3.errorBody")}`}>{t("step3.errorBody")}</p>
              <p className={`mt-1 ${hit("step3.quotaBody")}`}>{t("step3.quotaBody")}</p>
            </div>
            <p className={`mt-3 text-xs text-muted ${hit("step3.manualIntro")}`}>{t("step3.manualIntro")}</p>
            <div className="mt-2 grid gap-2"><PField k="step3.manualName" /><PField k="step3.manualAddress" /></div>
            <div className="mt-2 flex justify-end"><Btn k="step3.manualSubmit" /></div>
          </Box>
        </div>
      )}
      {step === 4 && (
        <div>
          <Head titleKey="step4.title" />
          <Box>
            <div className="flex justify-between text-xs font-bold uppercase tracking-wide text-navy">
              <span className={hit("step4.progress")}>{t("step4.progress")}</span>
              <span className={`text-muted ${hit("step4.single", "step4.multi")}`}>{t("step4.single")} / {t("step4.multi")}</span>
            </div>
            <div className="mt-2 h-1 bg-grey-bg"><div className="h-1 w-1/2 bg-navy" /></div>
            <p className="mt-3 text-lg font-light text-navy">Hvad er jeres vigtigste mål de næste 12 måneder?</p>
            <div className="mt-2 flex justify-between"><Btn k="common.back" secondary /><span className="flex gap-1"><Btn k="step4.next" /><Btn k="step4.last" /></span></div>
            <p className={`mt-3 text-xs text-muted ${hit("step4.empty")}`}>{t("step4.empty")}</p>
            <div className="mt-1"><Btn k="step4.emptySubmit" /></div>
          </Box>
        </div>
      )}
      {step === 5 && (
        <div>
          <Head titleKey="step5.title" />
          <p className={`mb-2 text-xs text-muted ${hit("step5.introTest", "step5.introNoTest")}`}>{t("step5.introTest")}</p>
          <p className={`mb-2 text-xs text-muted ${hit("step5.introNoTest")}`}>{t("step5.introNoTest")}</p>
          <div className="panel !p-4">
            <p className="font-semibold text-navy">Louise Vestergaard</p>
            <p className="text-xs text-muted">Salgsdirektør</p>
            <div className="mt-3 flex gap-2"><Btn k="step5.replace" secondary /><Btn k="step5.remove" secondary /></div>
            <div className="mt-2"><Btn k="step5.add" secondary /></div>
          </div>
          <div className="panel mt-2 !p-4">
            <span className={`eyebrow !mb-1 ${hit("step5.sideEyebrow")}`}>{t("step5.sideEyebrow")}</span>
            <p className={`label ${hit("step5.frequency")}`}>{t("step5.frequency")}</p>
            <p className={`text-xs text-muted ${hit("step5.priceLabel")}`}>{t("step5.priceLabel")}</p>
            <p className="text-2xl font-light text-navy">2.844 kr. / md.</p>
            <p className={`eyebrow mt-2 !mb-1 ${hit("step5.catalogEyebrow")}`}>{t("step5.catalogEyebrow")}</p>
            <div className="mt-2"><Btn k="step5.submit" /></div>
          </div>
        </div>
      )}
      {step === 6 && (
        <div>
          <Head titleKey="step6.title" />
          <Box>
            <p className={`label ${hit("step6.summaryLabel")}`}>{t("step6.summaryLabel")}</p>
            <p className="text-xs text-muted">Demo ApS · 3 rådgivere · Hver 8. uge</p>
          </Box>
          <div className="panel mt-2 grid gap-3 !p-4">
            <PField k="step6.passwordLabel" />
            <PField k="step6.confirmLabel" />
            <div className="flex items-start gap-2 text-xs text-muted"><span className="mt-0.5 h-4 w-4 shrink-0 border border-slate bg-white" aria-hidden="true" /><R k="step6.terms" /></div>
            <div className="flex items-start gap-2 border-l-4 border-gold bg-grey-bg px-3 py-2 text-xs text-ink"><span className="mt-0.5 h-4 w-4 shrink-0 border border-slate bg-white" aria-hidden="true" /><R k="step6.recordingConsent" /></div>
            <div className="flex justify-between"><Btn k="common.back" secondary /><Btn k="step6.submit" /></div>
          </div>
        </div>
      )}
    </div>
    </PreviewCtx.Provider>
  );
}
