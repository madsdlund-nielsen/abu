"use client";

import { useActionState } from "react";
import { saveNotificationPreferencesAction } from "@/app/actions/account";
import { changePasswordAction, loginAction, requestResetAction } from "@/app/actions/auth";
import { FormStatus } from "@/components/form-status";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

export function LoginForm({ next, initialEmail }: { next: string | null; initialEmail?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, EMPTY_FORM_STATE);
  return (
    <form data-no-guard action={action} className="space-y-4" key={state.at ?? 0} aria-busy={pending}>
      <FormStatus state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <div>
        <label className="label" htmlFor="email">E-mail</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email ?? initialEmail} />
      </div>
      <div>
        <label className="label" htmlFor="password">Adgangskode</label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required autoFocus={Boolean(state.error)} />
      </div>
      <button className="btn w-full" type="submit" disabled={pending}>{pending ? "Logger ind …" : "Log ind"}</button>
    </form>
  );
}

export function ResetRequestForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(requestResetAction, EMPTY_FORM_STATE);
  return (
    <form data-no-guard action={action} className="space-y-4" key={state.at ?? 0} aria-busy={pending}>
      <FormStatus state={state} />
      <div>
        <label className="label" htmlFor="email">E-mail</label>
        <input className="input" id="email" name="email" type="email" required autoComplete="email" defaultValue={state.values?.email} />
      </div>
      <button className="btn w-full" type="submit" disabled={pending}>Send nulstillingslink</button>
    </form>
  );
}

export function ChangePasswordForm({ minLength }: { minLength: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(changePasswordAction, EMPTY_FORM_STATE);
  return (
    <form data-no-guard action={action} className="mt-3 grid max-w-md gap-3" key={state.at ?? 0} aria-busy={pending}>
      <FormStatus state={state} />
      <div>
        <label className="label" htmlFor="current">Nuværende adgangskode</label>
        <input className="input" id="current" name="current" type="password" required autoComplete="current-password" />
      </div>
      <div>
        <label className="label" htmlFor="password">Ny adgangskode (mindst {minLength} tegn)</label>
        <input className="input" id="password" name="password" type="password" required minLength={minLength} autoComplete="new-password" />
      </div>
      <div><button className="btn" type="submit" disabled={pending}>Gem</button></div>
    </form>
  );
}

export function NotificationPrefsForm({ email, sms, hasPhone, marketing }: { email: boolean; sms: boolean; hasPhone: boolean; marketing: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveNotificationPreferencesAction, EMPTY_FORM_STATE);
  return (
    <form data-no-guard action={action} className="mt-3 grid gap-2 text-sm" aria-busy={pending}>
      <FormStatus state={state} />
      <label className="flex items-center gap-3">
        <input type="checkbox" name="email" className="h-4 w-4" defaultChecked={email} />
        Send mig e-mails om møder og abonnement
      </label>
      <label className="flex items-center gap-3">
        <input type="checkbox" name="sms" className="h-4 w-4" defaultChecked={sms} disabled={!hasPhone} />
        Send mig SMS om møder{!hasPhone && <span className="text-muted"> (tilføj et telefonnummer for at få SMS)</span>}
      </label>
      {marketing && (
        <label className="mt-2 flex items-start gap-3 border-t border-grey-bg pt-3">
          <input type="checkbox" name="marketing" className="mt-1 h-4 w-4 shrink-0" defaultChecked />
          <span>
            Opfølgning og relevante tilbud fra Advisory Board Unlimited på e-mail og SMS
            <span className="block text-xs text-muted">{marketing} Fjern krydset for at trække samtykket tilbage.</span>
          </span>
        </label>
      )}
      <div className="mt-1"><button className="btn-secondary btn-sm" type="submit" disabled={pending}>Gem</button></div>
    </form>
  );
}
