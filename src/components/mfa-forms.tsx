"use client";

import { useActionState, useRef, useState } from "react";
import {
  confirmMfaSetupAction,
  disableMfaAction,
  finishMfaSetupAction,
  regenerateRecoveryCodesAction,
  reverifyMfaAction,
  verifyMfaLoginAction,
  type MfaCodesState,
} from "@/app/actions/mfa";
import { FormStatus } from "@/components/form-status";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

/**
 * Felt til den 6-cifrede kode: numerisk tastatur, autocomplete="one-time-code" (iOS/Android foreslår koden), kun
 * cifre, og formularen sendes automatisk, når der står 6 cifre (Enter og knappen virker også).
 */
export function TotpCodeInput({ id = "code", label = "Kode fra appen", pending, autoFocus = true }: { id?: string; label?: string; pending: boolean; autoFocus?: boolean }) {
  const [value, setValue] = useState("");
  const sent = useRef("");
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input
        className="input max-w-[12rem] text-center font-mono text-2xl tracking-[0.3em]"
        id={id}
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoFocus={autoFocus}
        aria-describedby={`${id}-hint`}
        value={value}
        data-testid="totp-input"
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
          setValue(digits);
          // Send automatisk ved 6 cifre (én gang pr. kode, ikke mens et forsøg er i gang)
          if (digits.length === 6 && !pending && sent.current !== digits) {
            sent.current = digits;
            const form = e.target.form;
            setTimeout(() => form?.requestSubmit(), 0);
          }
        }}
      />
      <p id={`${id}-hint`} className="mt-1 text-xs text-muted">6 cifre. Sendes automatisk, når koden er indtastet.</p>
    </div>
  );
}

/** Login, trin 2: kode fra appen, eller en gendannelseskode. «Husk denne enhed» springer koden over i N dage. */
export function MfaVerifyForm({ next, rememberDays }: { next: string | null; rememberDays: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(verifyMfaLoginAction, EMPTY_FORM_STATE);
  const [mode, setMode] = useState<"totp" | "recovery">(state.values?.mode === "recovery" ? "recovery" : "totp");
  return (
    <form data-no-guard action={action} className="space-y-4" key={`${state.at ?? 0}-${mode}`} aria-busy={pending}>
      <FormStatus state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <input type="hidden" name="mode" value={mode} />
      {mode === "totp" ? (
        <TotpCodeInput pending={pending} />
      ) : (
        <div>
          <label className="label" htmlFor="recoveryCode">Gendannelseskode</label>
          <input className="input max-w-[16rem] font-mono" id="recoveryCode" name="recoveryCode" autoComplete="off" autoCapitalize="none" spellCheck={false} required autoFocus placeholder="xxxxx-xxxxx" data-testid="recovery-input" />
          <p className="mt-1 text-xs text-muted">Hver gendannelseskode virker kun én gang.</p>
        </div>
      )}
      {rememberDays > 0 && (
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="remember" className="mt-1 h-4 w-4 shrink-0" data-testid="remember-device" />
          <span>
            Husk denne enhed i {rememberDays} dage
            <span className="block text-xs text-muted">Du skal stadig bruge din adgangskode. Brug det ikke på en delt computer.</span>
          </span>
        </label>
      )}
      <button className="btn w-full" type="submit" disabled={pending}>{pending ? "Bekræfter …" : "Bekræft"}</button>
      <p className="text-sm">
        {mode === "totp" ? (
          <button type="button" className="underline hover:text-gold-ink" onClick={() => setMode("recovery")}>Brug en gendannelseskode i stedet</button>
        ) : (
          <button type="button" className="underline hover:text-gold-ink" onClick={() => setMode("totp")}>Brug koden fra appen i stedet</button>
        )}
      </p>
    </form>
  );
}

/** Gendannelseskoderne vises én gang: liste, download som .txt og «Jeg har gemt dem». */
export function RecoveryCodesPanel({ codes, email, continueTo, finishNext }: { codes: string[]; email: string; continueTo?: string; finishNext?: string | null }) {
  const [saved, setSaved] = useState(false);
  const text = [
    "Advisory Board Unlimited – gendannelseskoder til totrinsbekræftelse",
    `Konto: ${email}`,
    "",
    "Hver kode kan bruges én gang, hvis du ikke har adgang til din godkendelses-app.",
    "Nye koder ugyldiggør disse.",
    "",
    ...codes,
    "",
  ].join("\n");
  return (
    <section aria-labelledby="codes-h" data-testid="recovery-codes">
      <h2 id="codes-h" className="text-xl">Dine gendannelseskoder</h2>
      <p className="mt-2 text-sm text-muted">
        Gem koderne et sikkert sted, fx i din adgangskodemanager. Mister du telefonen, kan du logge ind med én af dem. Hver kode virker
        én gang. <strong className="text-ink">De vises kun nu.</strong>
      </p>
      <ol className="mt-space-3 grid grid-cols-2 gap-x-6 gap-y-1 border border-grey-bg bg-grey-bg p-space-3 font-mono text-base text-ink">
        {codes.map((c) => (
          <li key={c} data-testid="recovery-code">{c}</li>
        ))}
      </ol>
      <div className="mt-space-3 flex flex-wrap items-center gap-3">
        <a className="btn-secondary" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download="abu-gendannelseskoder.txt">
          Download (.txt)
        </a>
      </div>
      <label className="mt-space-4 flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={saved} onChange={(e) => setSaved(e.target.checked)} data-testid="codes-saved" />
        <span>Jeg har gemt mine gendannelseskoder et sikkert sted.</span>
      </label>
      <div className="mt-space-3">
        {continueTo ? (
          saved ? (
            <a href={continueTo} className="btn">Jeg har gemt dem</a>
          ) : (
            <button type="button" className="btn" disabled>Jeg har gemt dem</button>
          )
        ) : (
          <form action={finishMfaSetupAction}>
            {finishNext && <input type="hidden" name="next" value={finishNext} />}
            <button type="submit" className="btn" disabled={!saved} data-testid="codes-continue">Jeg har gemt dem – fortsæt</button>
          </form>
        )}
      </div>
    </section>
  );
}

/** Opsætning: bekræft med en kode fra appen, derefter gendannelseskoderne. */
export function MfaSetupForm({ next, email }: { next: string | null; email: string }) {
  const [state, action, pending] = useActionState<MfaCodesState, FormData>(confirmMfaSetupAction, {});
  if (state.codes) {
    return (
      <div>
        <p role="status" className="callout mb-space-4 text-sm" data-testid="mfa-enabled">{state.ok}</p>
        <RecoveryCodesPanel codes={state.codes} email={email} finishNext={next} />
      </div>
    );
  }
  return (
    <form data-no-guard action={action} className="space-y-4" key={state.at ?? 0} aria-busy={pending}>
      <FormStatus state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <TotpCodeInput pending={pending} label="Kode fra appen (bekræfter opsætningen)" autoFocus={false} />
      <button className="btn" type="submit" disabled={pending}>{pending ? "Bekræfter …" : "Slå totrinsbekræftelse til"}</button>
    </form>
  );
}

/** Bekræft med kode igen før følsomme handlinger. */
export function ReverifyForm({ next }: { next: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reverifyMfaAction, EMPTY_FORM_STATE);
  return (
    <form data-no-guard action={action} className="space-y-4" key={state.at ?? 0} aria-busy={pending}>
      <FormStatus state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <TotpCodeInput pending={pending} />
      <button className="btn w-full" type="submit" disabled={pending}>{pending ? "Bekræfter …" : "Bekræft"}</button>
    </form>
  );
}

/** Nye gendannelseskoder (kræver en aktuel kode). */
export function RegenerateCodesForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<MfaCodesState, FormData>(regenerateRecoveryCodesAction, {});
  if (state.codes) {
    return (
      <div className="mt-space-3">
        <p role="status" className="callout mb-space-3 text-sm">{state.ok}</p>
        <RecoveryCodesPanel codes={state.codes} email={email} continueTo="/account?koder=nye#totrin" />
      </div>
    );
  }
  return (
    <form data-no-guard action={action} className="mt-space-3 grid max-w-md gap-3" key={state.at ?? 0} aria-busy={pending}>
      <FormStatus state={state} />
      <TotpCodeInput id="regen-code" pending={pending} label="Aktuel kode fra appen" autoFocus={false} />
      <div><button className="btn-secondary" type="submit" disabled={pending}>Lav nye gendannelseskoder</button></div>
    </form>
  );
}

/** Slå valgfri totrinsbekræftelse fra (rådgivere og kunder). */
export function DisableMfaForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(disableMfaAction, EMPTY_FORM_STATE);
  return (
    <form data-no-guard action={action} className="mt-space-3 grid max-w-md gap-3" key={state.at ?? 0} aria-busy={pending} data-confirm="Slå totrinsbekræftelse fra? Dine betroede enheder og gendannelseskoder fjernes.">
      <FormStatus state={state} />
      <div>
        <label className="label" htmlFor="disable-code">Kode fra appen eller en gendannelseskode</label>
        <input className="input max-w-[16rem] font-mono" id="disable-code" name="code" autoComplete="one-time-code" required />
      </div>
      <div><button className="btn-danger" type="submit" disabled={pending}>Slå totrinsbekræftelse fra</button></div>
    </form>
  );
}
