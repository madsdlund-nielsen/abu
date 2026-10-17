"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveCompanyAction, saveContactAction } from "@/app/actions/onboarding";
import { FormStatus } from "@/components/form-status";
import { Rich } from "@/components/rich";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

type Texts = Record<string, string>;

/** Trin 1: fejl vises på siden, og indtastningerne bevares – uden navn/e-mail i URL'en (plan #22). */
export function ContactStepForm({ t, initial }: { t: Texts; initial: { name?: string; email?: string; consent?: boolean } }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveContactAction, EMPTY_FORM_STATE);
  const v = state.values;
  return (
    <form data-no-guard action={action} className="grid gap-4" key={state.at ?? 0} aria-busy={pending}>
      <FormStatus state={state} />
      <div>
        <label className="label" htmlFor="name">{t["step1.nameLabel"]}</label>
        <input className="input" id="name" name="name" required autoComplete="name" defaultValue={v?.name ?? initial.name} />
      </div>
      <div>
        <label className="label" htmlFor="email">{t["step1.emailLabel"]}</label>
        <input className="input" id="email" name="email" type="email" required autoComplete="email" defaultValue={v?.email ?? initial.email} />
      </div>
      <label className="flex items-start gap-3 text-sm text-muted">
        {/* Aktivt samtykke: aldrig forudkrydset (markedsføringsloven/GDPR). Teksten gemmes ordret sammen med samtykket. */}
        <input type="checkbox" name="contactConsent" className="mt-1 h-4 w-4 shrink-0" defaultChecked={v ? v.contactConsent === "on" : initial.consent} />
        <span><Rich text={t["step1.consent"]} /></span>
      </label>
      <div className="flex items-center justify-between gap-3 pt-2">
        <p className="text-sm text-muted"><Rich text={t["step1.loginHint"]} /></p>
        <button className="btn" type="submit" disabled={pending}>{t["step1.submit"]}</button>
      </div>
    </form>
  );
}

export function CompanyStepForm({ t, initial }: { t: Texts; initial: { cvr?: string; phone?: string } }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveCompanyAction, EMPTY_FORM_STATE);
  const v = state.values;
  return (
    <form data-no-guard action={action} className="grid gap-4" key={state.at ?? 0} aria-busy={pending}>
      <FormStatus state={state} />
      <div>
        <label className="label" htmlFor="cvr">{t["step2.cvrLabel"]}</label>
        <input className="input" id="cvr" name="cvr" required inputMode="numeric" placeholder={t["step2.cvrPlaceholder"]} autoComplete="off" defaultValue={v?.cvr ?? initial.cvr} />
      </div>
      <div>
        <label className="label" htmlFor="phone">{t["step2.phoneLabel"]}</label>
        <input className="input" id="phone" name="phone" type="tel" required autoComplete="tel" placeholder={t["step2.phonePlaceholder"]} defaultValue={v?.phone ?? initial.phone} />
      </div>
      <div className="flex items-center justify-between gap-3 pt-2">
        <Link href="/kom-i-gang?trin=1" className="btn-secondary">{t["common.back"]}</Link>
        <button className="btn" type="submit" disabled={pending}>{pending ? "Slår op …" : t["step2.submit"]}</button>
      </div>
    </form>
  );
}
