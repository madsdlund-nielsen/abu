import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  answerQuestionAction,
  completeOnboardingAction,
  confirmCompanyAction,
  manualCompanyAction,
  saveBoardAction,
  saveCompanyAction,
  saveContactAction,
  skipTestAction,
} from "@/app/actions/onboarding";
import { Band } from "@/components/band";
import { BoardBuilder } from "@/components/board-builder";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { Stepper } from "@/components/onboarding/stepper";
import { Rich } from "@/components/rich";
import { PageShell } from "@/components/site-header";
import { getCurrentUser, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { getOnboardingTexts } from "@/lib/content/server";
import { interpolate, type OnboardingTexts } from "@/lib/content/onboarding-texts";
import { resolveBoard } from "@/lib/onboarding/board";
import { loadActiveQuestions, loadCatalog } from "@/lib/onboarding/catalog";
import { asSuggestion, getOnboardingSession, TOTAL_STEPS, type OnboardingState } from "@/lib/onboarding/session";
import { formatDkk, frequencyLabel, vatBreakdown } from "@/lib/pricing";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Kom i gang" };
export const dynamic = "force-dynamic";

type T = OnboardingTexts;

export default async function KomIGang({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");
  const { err, one, params } = await flashFrom(searchParams);
  const [state, t] = await Promise.all([getOnboardingSession(), getOnboardingTexts()]);
  const reached = state?.step ?? 1;
  const requested = Math.min(TOTAL_STEPS, Math.max(1, Number(one(params.trin)) || reached));
  const step = state ? Math.min(requested, reached) : 1;
  const wide = step === 5;
  const labels = [1, 2, 3, 4, 5, 6].map((n) => t[`common.stepLabel${n}`]);

  return (
    <PageShell variant="bare">
      <Band tone="grey" tight className="min-h-[70vh]">
        <div className="mx-auto max-w-5xl pt-space-3 sm:pt-space-4">
          <Stepper current={step} reached={reached} labels={labels} />
          <div className={wide ? "" : "mx-auto max-w-xl"}>
            <span className="eyebrow hidden sm:block">{interpolate(t["common.eyebrow"], { n: step, total: TOTAL_STEPS, trin: labels[step - 1] })}</span>
            <h1 className="mb-space-4">{t[`step${step}.title`]}</h1>
            {err &&
              (one(params.konto) ? (
                <div role="alert" className="callout callout-error mb-space-4 text-sm">
                  {err} <Link href="/login">Log ind her</Link>, eller brug en anden e-mail.
                </div>
              ) : (
                <Flash err={err} />
              ))}
            {step === 1 && <StepContact state={state} t={t} n={one(params.n)} e={one(params.e)} />}
            {step === 2 && state && <StepCompany state={state} t={t} cvr={one(params.cvr)} tlf={one(params.tlf)} />}
            {step === 3 && state && <StepConfirm state={state} t={t} />}
            {step === 4 && state && <StepTest state={state} t={t} q={Number(one(params.q)) || 1} />}
            {step === 5 && state && <StepBoard state={state} t={t} />}
            {step === 6 && state && <StepAccount state={state} t={t} />}
          </div>
        </div>
      </Band>
    </PageShell>
  );
}

function Back({ step, extra = "", t }: { step: number; extra?: string; t: T }) {
  return (
    <Link href={`/kom-i-gang?trin=${step}${extra}`} className="btn-secondary">
      {t["common.back"]}
    </Link>
  );
}

function StepContact({ state, t, n, e }: { state: OnboardingState | null; t: T; n?: string; e?: string }) {
  const c = state?.data.contact;
  return (
    <div className="panel">
      <p className="mb-space-4 text-muted">{t["step1.intro"]}</p>
      <form action={saveContactAction} className="grid gap-4">
        <div>
          <label className="label" htmlFor="name">{t["step1.nameLabel"]}</label>
          <input className="input" id="name" name="name" required autoComplete="name" defaultValue={n ?? c?.name} />
        </div>
        <div>
          <label className="label" htmlFor="email">{t["step1.emailLabel"]}</label>
          <input className="input" id="email" name="email" type="email" required autoComplete="email" defaultValue={e ?? c?.email} />
        </div>
        <label className="flex items-start gap-3 text-sm text-muted">
          {/* Aktivt samtykke: aldrig forudkrydset (markedsføringsloven/GDPR). Teksten gemmes ordret sammen med samtykket. */}
          <input type="checkbox" name="contactConsent" className="mt-1 h-4 w-4 shrink-0" defaultChecked={state?.marketingConsent} />
          <span><Rich text={t["step1.consent"]} /></span>
        </label>
        <div className="flex items-center justify-between gap-3 pt-2">
          <p className="text-sm text-muted"><Rich text={t["step1.loginHint"]} /></p>
          <button className="btn" type="submit">{t["step1.submit"]}</button>
        </div>
      </form>
    </div>
  );
}

function StepCompany({ state, t, cvr, tlf }: { state: OnboardingState; t: T; cvr?: string; tlf?: string }) {
  const co = state.data.company;
  return (
    <div className="panel">
      <p className="mb-space-4 text-muted">{t["step2.intro"]}</p>
      <form action={saveCompanyAction} className="grid gap-4">
        <div>
          <label className="label" htmlFor="cvr">{t["step2.cvrLabel"]}</label>
          <input className="input" id="cvr" name="cvr" required inputMode="numeric" placeholder={t["step2.cvrPlaceholder"]} autoComplete="off" defaultValue={cvr ?? co?.cvr} />
        </div>
        <div>
          <label className="label" htmlFor="phone">{t["step2.phoneLabel"]}</label>
          <input className="input" id="phone" name="phone" type="tel" required autoComplete="tel" placeholder={t["step2.phonePlaceholder"]} defaultValue={tlf ?? co?.phone} />
        </div>
        <div className="flex items-center justify-between gap-3 pt-2">
          <Back step={1} t={t} />
          <button className="btn" type="submit">{t["step2.submit"]}</button>
        </div>
      </form>
    </div>
  );
}

function StepConfirm({ state, t }: { state: OnboardingState; t: T }) {
  const co = state.data.company;
  if (!co) redirect("/kom-i-gang?trin=2");
  const info = co.info;
  const rows: [string, string][] = info
    ? [
        ["Navn", info.name],
        ["Adresse", info.address],
        ["Postnr. og by", `${info.zip} ${info.city}`.trim()],
        ["Virksomhedsform", info.companyForm],
        ["Branche", [info.industryCode, info.industryText].filter(Boolean).join(" · ")],
        ["Startdato", info.startDate ? formatDate(new Date(info.startDate)) : "Ukendt"],
        ["Antal ansatte", info.employees ?? "Ukendt"],
        ["Status", info.statusText],
      ]
    : [];
  return (
    <div className="space-y-space-3">
      {co.lookup === "ok" && info && (
        <div className="panel">
          <p className="label">CVR {co.cvr}</p>
          <dl className="mt-3 divide-y divide-grey-bg text-sm" data-testid="company-card">
            {rows.map(([k, v]) => (
              <div key={k} className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr]">
                <dt className="text-muted">{k}</dt>
                <dd className="font-semibold text-navy">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">{t["step3.source"]}</p>
          <div className="mt-space-4 flex items-center justify-between gap-3">
            <Back step={2} t={t} />
            <form action={confirmCompanyAction}>
              <button className="btn" type="submit">{t["step3.confirm"]}</button>
            </form>
          </div>
          <p className="mt-3 text-sm"><Link href="/kom-i-gang?trin=2">{t["step3.wrong"]}</Link></p>
        </div>
      )}
      {co.lookup === "ceased" && info && (
        <div className="panel">
          <div role="alert" className="callout callout-error text-sm">
            <p className="font-semibold">{t["step3.ceasedTitle"]}</p>
            <p>{interpolate(t["step3.ceasedBody"], { cvr: co.cvr, navn: info.name, status: info.statusText })}</p>
          </div>
          <div className="mt-space-4"><Back step={2} t={t} /></div>
        </div>
      )}
      {(co.lookup === "not_found" || co.lookup === "error") && (
        <div className="panel">
          <div role="alert" className="callout callout-error text-sm">
            <p className="font-semibold">{co.lookup === "not_found" ? t["step3.notFoundTitle"] : t["step3.errorTitle"]}</p>
            <p>{co.lookup === "not_found" ? interpolate(t["step3.notFoundBody"], { cvr: co.cvr }) : co.quota ? t["step3.quotaBody"] : t["step3.errorBody"]}</p>
          </div>
          <form action={manualCompanyAction} className="mt-space-4 grid gap-4">
            <p className="text-sm text-muted">{t["step3.manualIntro"]}</p>
            <div>
              <label className="label" htmlFor="name">{t["step3.manualName"]}</label>
              <input className="input" id="name" name="name" required defaultValue={co.manual?.name} />
            </div>
            <div>
              <label className="label" htmlFor="address">{t["step3.manualAddress"]}</label>
              <input className="input" id="address" name="address" required defaultValue={co.manual?.address} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Back step={2} t={t} />
              <button className="btn" type="submit">{t["step3.manualSubmit"]}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

async function StepTest({ state, t, q }: { state: OnboardingState; t: T; q: number }) {
  const questions = await loadActiveQuestions();
  if (questions.length === 0) {
    return (
      <div className="panel">
        <p className="text-muted">{t["step4.empty"]}</p>
        <form action={skipTestAction} className="mt-space-4 flex justify-between"><Back step={3} t={t} /><button className="btn" type="submit">{t["step4.emptySubmit"]}</button></form>
      </div>
    );
  }
  const idx = Math.min(Math.max(1, q), questions.length);
  const question = questions[idx - 1];
  const chosen = new Set(state.answers[question.id] ?? []);
  const multi = question.type === "MULTI";
  const last = idx === questions.length;
  return (
    <div className="panel">
      <div className="mb-space-4">
        <div className="flex items-baseline justify-between text-xs font-bold uppercase tracking-wide text-navy">
          <span>{interpolate(t["step4.progress"], { n: idx, total: questions.length })}</span>
          <span className="text-muted">{multi ? t["step4.multi"] : t["step4.single"]}</span>
        </div>
        <div className="mt-2 h-1 bg-grey-bg" role="progressbar" aria-valuemin={1} aria-valuemax={questions.length} aria-valuenow={idx} aria-label="Fremdrift i testen">
          <div className="h-1 bg-navy" style={{ width: `${(idx / questions.length) * 100}%` }} />
        </div>
      </div>
      <form action={answerQuestionAction}>
        <input type="hidden" name="q" value={idx} />
        <fieldset>
          <legend className="text-2xl font-light leading-snug text-navy">{question.text}</legend>
          {question.helpText && <p className="mt-2 text-sm text-muted">{question.helpText}</p>}
          <div className="mt-space-4 grid gap-2">
            {question.answers.map((a) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-start gap-3 border border-slate bg-white px-4 py-3 transition-colors hover:border-navy has-[:checked]:border-navy has-[:checked]:bg-grey-bg has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold-dark"
              >
                <input
                  type={multi ? "checkbox" : "radio"}
                  name="answerIds"
                  value={a.id}
                  defaultChecked={chosen.has(a.id)}
                  className="mt-1.5 h-4 w-4 shrink-0"
                  required={!multi}
                />
                <span className="text-ink">{a.text}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-space-4 flex items-center justify-between gap-3">
          <Back step={idx === 1 ? 3 : 4} extra={idx === 1 ? "" : `&q=${idx - 1}`} t={t} />
          <button className="btn" type="submit">{last ? t["step4.last"] : t["step4.next"]}</button>
        </div>
      </form>
    </div>
  );
}

async function StepBoard({ state, t }: { state: OnboardingState; t: T }) {
  const catalog = await loadCatalog();
  const suggestion = asSuggestion(state.suggested);
  const needs = suggestion?.needs ?? {};
  const ids = state.data.board?.advisorIds?.length ? state.data.board.advisorIds : (suggestion?.advisorIds ?? []);
  const hasTest = Object.keys(needs).length > 0;
  const suggestedSize = suggestion?.size ?? ids.length;
  return (
    <BoardBuilder
      advisors={catalog.advisors}
      tags={catalog.tags}
      needs={needs}
      initialAdvisorIds={ids}
      initialWeeks={state.data.board?.weeks ?? null}
      action={saveBoardAction}
      submitLabel={t["step5.submit"]}
      backHref={`/kom-i-gang?trin=4&q=99`}
      texts={{
        sideEyebrow: t["step5.sideEyebrow"],
        replace: t["step5.replace"],
        remove: t["step5.remove"],
        add: t["step5.add"],
        frequency: t["step5.frequency"],
        priceLabel: t["step5.priceLabel"],
        catalogEyebrow: t["step5.catalogEyebrow"],
      }}
      intro={hasTest ? interpolate(t["step5.introTest"], { antal: suggestedSize }) : t["step5.introNoTest"]}
    />
  );
}

async function StepAccount({ state, t }: { state: OnboardingState; t: T }) {
  const { contact, company, board: chosen } = state.data;
  if (!contact || !company?.confirmed) redirect("/kom-i-gang?trin=3");
  if (!chosen?.weeks) redirect("/kom-i-gang?trin=5");
  const board = await resolveBoard(chosen.advisorIds, chosen.weeks);
  if ("error" in board) redirect(`/kom-i-gang?trin=5&err=${encodeURIComponent(board.error)}`);
  const vat = vatBreakdown(board.monthlyPriceDkk);
  const name = company.info?.name ?? company.manual?.name ?? "";
  return (
    <div className="space-y-space-3">
      <section className="panel" aria-label="Resumé">
        <p className="label">{t["step6.summaryLabel"]}</p>
        <dl className="mt-2 divide-y divide-grey-bg text-sm">
          <div className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr]"><dt className="text-muted">Virksomhed</dt><dd className="font-semibold text-navy">{name} · CVR {company.cvr}</dd></div>
          <div className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr]"><dt className="text-muted">Kontakt</dt><dd>{contact.name} · {contact.email}</dd></div>
          <div className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted">Board</dt>
            <dd>
              <ul>
                {board.advisors.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3"><span>{a.name}</span><span className="text-muted">{formatDkk(a.pricePerMeetingDkk)} pr. møde</span></li>
                ))}
              </ul>
            </dd>
          </div>
          <div className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr]"><dt className="text-muted">Frekvens</dt><dd>{frequencyLabel(board.weeks)}</dd></div>
        </dl>
        <dl className="mt-space-3 border-t border-navy pt-space-3 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Månedspris ekskl. moms</dt><dd data-testid="summary-ex">{formatDkk(vat.exVat)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Moms (25 %)</dt><dd>{formatDkk(vat.vat)}</dd></div>
          <div className="mt-1 flex justify-between text-lg"><dt className="font-semibold text-navy">I alt pr. måned</dt><dd className="font-semibold text-navy" data-testid="summary-inc">{formatDkk(vat.incVat)}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-muted">
          <Link href="/kom-i-gang?trin=5">Ret board eller frekvens</Link>
        </p>
      </section>
      <form action={completeOnboardingAction} className="panel grid gap-4">
        <div>
          <label className="label" htmlFor="password">{interpolate(t["step6.passwordLabel"], { min: MIN_PASSWORD_LENGTH })}</label>
          <input className="input" id="password" name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
        </div>
        <div>
          <label className="label" htmlFor="confirm">{t["step6.confirmLabel"]}</label>
          <input className="input" id="confirm" name="confirm" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
        </div>
        <label className="flex items-start gap-3 text-sm text-muted">
          <input type="checkbox" name="consent" className="mt-1 h-4 w-4 shrink-0" required />
          <span><Rich text={t["step6.terms"]} linkTarget="_blank" /></span>
        </label>
        <label className="flex items-start gap-3 border-l-4 border-gold bg-grey-bg px-4 py-3 text-sm text-ink">
          <input type="checkbox" name="recordingConsent" className="mt-1 h-4 w-4 shrink-0" required />
          <span><Rich text={t["step6.recordingConsent"]} /></span>
        </label>
        <div className="flex items-center justify-between gap-3">
          <Back step={5} t={t} />
          <button className="btn" type="submit">{t["step6.submit"]}</button>
        </div>
      </form>
    </div>
  );
}
