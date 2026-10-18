"use client";

import { useActionState } from "react";
import { addBlockAction, addRuleAction, updateProfileAction } from "@/app/actions/advisor";
import { updateAdvisorProfileByAdminAction } from "@/app/actions/admin";
import { AdvisorPhotoField } from "@/components/advisor-photo-field";
import { DateTimeField, TimeSelect } from "@/components/date-time-field";
import { FormStatus } from "@/components/form-status";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";
import { WEEKDAY_NAMES } from "@/lib/time";

export function AddRuleForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addRuleAction, EMPTY_FORM_STATE);
  const v = state.error ? state.values : undefined;
  return (
    <form data-no-guard action={action} className="mt-5 grid gap-3 sm:grid-cols-4" aria-busy={pending} key={state.at ?? 0}>
      <FormStatus state={state} className="sm:col-span-4" />
      <div>
        <label className="label" htmlFor="weekday">Ugedag</label>
        <select className="input" id="weekday" name="weekday" defaultValue={v?.weekday ?? "1"}>
          {WEEKDAY_NAMES.slice(1).map((n, i) => (
            <option key={n} value={i + 1}>{n}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="start">Fra</label>
        <TimeSelect id="start" name="start" defaultValue={v?.start ?? "09:00"} />
      </div>
      <div>
        <label className="label" htmlFor="end">Til</label>
        <TimeSelect id="end" name="end" defaultValue={v?.end ?? "16:00"} allowEndOfDay />
      </div>
      <div className="flex items-end"><button className="btn w-full" type="submit" disabled={pending}>Tilføj</button></div>
    </form>
  );
}

export function AddBlockForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addBlockAction, EMPTY_FORM_STATE);
  const v = state.error ? state.values : undefined;
  // Ny key pr. svar: tom formular efter gem, genudfyldt med indtastningerne efter en fejl
  return (
    <form data-no-guard action={action} className="mt-5 grid gap-4 sm:grid-cols-2" aria-busy={pending} key={state.at ?? 0}>
      <FormStatus state={state} className="sm:col-span-2" />
      <DateTimeField name="from" label="Fra" defaultDate={v?.fromDate ?? ""} defaultTime={v?.fromTime ?? "09:00"} />
      <DateTimeField name="to" label="Til" defaultDate={v?.toDate ?? ""} defaultTime={v?.toTime ?? "24:00"} allowEndOfDay />
      <div>
        <label className="label" htmlFor="reason">Årsag (valgfri)</label>
        <input className="input" id="reason" name="reason" maxLength={200} defaultValue={v?.reason ?? ""} />
      </div>
      <div className="flex items-end"><button className="btn w-full" type="submit" disabled={pending}>Bloker</button></div>
      <p className="text-xs text-muted sm:col-span-2">Vælg «24:00» som sluttidspunkt for at blokere hele dagen.</p>
    </form>
  );
}

/**
 * Rådgiverens profil. `mode="self"` (standard) er rådgiverens egen formular på /profile; `mode="admin"` bruges på
 * /admin/advisors/[id] til titel, bio og mobilnummer med samme validering (navnet rettes ikke her). Profilbilledet
 * øverst uploades og gemmes for sig (egen server action), uden for formularen.
 */
export function ProfileForm({
  initial,
  mode = "self",
  advisorId,
  photoVersion,
}: {
  initial: { name: string; phone: string; title: string; bio: string };
  mode?: "self" | "admin";
  advisorId: string;
  /** Version af det nuværende profilbillede (null = intet billede) */
  photoVersion: string | null;
}) {
  const admin = mode === "admin";
  const [state, action, pending] = useActionState<FormState, FormData>(admin ? updateAdvisorProfileByAdminAction : updateProfileAction, EMPTY_FORM_STATE);
  const v = { ...initial, ...(state.values ?? {}) };
  return (
    <div className="grid gap-space-4">
      <AdvisorPhotoField advisorId={advisorId} name={initial.name} version={photoVersion} mode={mode} />
      <form data-no-guard action={action} className="grid gap-4 border-t border-grey-bg pt-space-4" aria-busy={pending} data-testid={admin ? "admin-profile-form" : "profile-form"}>
        <FormStatus state={state} />
        {admin ? (
          <input type="hidden" name="userId" value={advisorId} />
        ) : (
          <div>
            <label className="label" htmlFor="name">Navn</label>
            <input className="input" id="name" name="name" defaultValue={v.name} required />
          </div>
        )}
        <div>
          <label className="label" htmlFor="phone">Mobilnummer (til SMS-påmindelser)</label>
          <input className="input" id="phone" name="phone" type="tel" autoComplete={admin ? "off" : "tel"} defaultValue={v.phone} placeholder="20 30 40 50" aria-describedby="phone-help" />
          <p id="phone-help" className="mt-1 text-xs text-muted">
            {admin ? "Valgfrit. Bruges kun til påmindelser om rådgiverens møder. Rådgiveren kan slå SMS fra under Konto." : "Valgfrit. Bruges kun til påmindelser om dine møder. Du kan slå SMS fra under Konto."}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="title">Titel</label>
          <input className="input" id="title" name="title" defaultValue={v.title} maxLength={120} />
        </div>
        <div>
          <label className="label" htmlFor="bio">Præsentation</label>
          <textarea className="input min-h-32" id="bio" name="bio" defaultValue={v.bio} maxLength={4000} aria-describedby={admin ? "bio-help" : undefined} />
          {admin && <p id="bio-help" className="mt-1 text-xs text-muted">Vises for kunder i kataloget. Påkrævet for at kunne aktivere rådgiveren.</p>}
        </div>
        <div><button className="btn" type="submit" disabled={pending}>{pending ? "Gemmer …" : "Gem profil"}</button></div>
      </form>
    </div>
  );
}
