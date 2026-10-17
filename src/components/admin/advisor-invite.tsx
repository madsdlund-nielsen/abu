"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createAdvisorAction, resendInviteAction, type InviteState } from "@/app/actions/admin";

function InviteLink({ link }: { link: string }) {
  return (
    <div className="callout mt-3 text-sm">
      <p className="font-medium">Invitationslink (vises, fordi e-mail kører i konsol-tilstand eller ikke kunne sendes). Gyldigt i 7 dage, kan bruges én gang:</p>
      <p className="mt-2 break-all bg-grey-bg p-2 font-mono text-xs" data-testid="invite-link">{link}</p>
    </div>
  );
}

/** Opret rådgiver: beholder indtastningerne ved fejl, og linket vises i UI'et – aldrig i URL'en. */
export function NewAdvisorForm({ idem }: { idem: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(createAdvisorAction, {});
  if (state.ok) {
    return (
      <div>
        <p role="status" className="callout text-sm" data-testid="advisor-created">{state.ok}</p>
        {state.inviteLink && <InviteLink link={state.inviteLink} />}
        <p className="mt-space-3 text-sm text-muted">Rådgiveren er inaktiv og kan ikke vælges af kunder, før du aktiverer vedkommende under Rådgivere.</p>
        <div className="mt-space-3 flex flex-wrap gap-3">
          <Link href="/admin/advisors" className="btn-secondary">Til rådgivere</Link>
          {/* Fuld genindlæsning: ny formular-nøgle og tom formular */}
          <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>Opret en til</button>
        </div>
      </div>
    );
  }
  const v = state.values;
  return (
    <form data-no-guard action={action} className="grid gap-4" aria-busy={pending}>
      <input type="hidden" name="idem" value={idem} />
      {state.error && <p role="alert" className="callout callout-error text-sm">{state.error}</p>}
      <div>
        <label className="label" htmlFor="name">Navn</label>
        <input className="input" id="name" name="name" required defaultValue={v?.name} />
      </div>
      <div>
        <label className="label" htmlFor="email">E-mail</label>
        <input className="input" id="email" name="email" type="email" required defaultValue={v?.email} />
      </div>
      <div>
        <label className="label" htmlFor="title">Titel (valgfri)</label>
        <input className="input" id="title" name="title" maxLength={120} defaultValue={v?.title} />
      </div>
      <div><button className="btn" type="submit" disabled={pending}>{pending ? "Opretter …" : "Opret og send invitation"}</button></div>
    </form>
  );
}

export function ResendInviteButton({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(resendInviteAction, {});
  return (
    <div>
      <form data-no-guard action={action}>
        <input type="hidden" name="userId" value={userId} />
        <button className="btn-secondary btn-sm" type="submit" disabled={pending}>Ny invitation</button>
      </form>
      {state.error && <p role="alert" className="mt-1 text-xs text-danger">{state.error}</p>}
      {state.ok && <p role="status" className="mt-1 text-xs text-muted">{state.ok}</p>}
      {state.inviteLink && <InviteLink link={state.inviteLink} />}
    </div>
  );
}
