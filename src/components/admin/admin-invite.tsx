"use client";

import { useActionState } from "react";
import { inviteAdminAction, resendAdminInviteAction, type AdminInviteState } from "@/app/actions/admin-users";

function InviteLink({ link }: { link: string }) {
  return (
    <div className="callout mt-3 text-sm">
      <p className="font-medium">Invitationslink (vises, fordi e-mail kører i konsol-tilstand eller ikke kunne sendes). Gyldigt i 7 dage, kan bruges én gang:</p>
      <p className="mt-2 break-all bg-grey-bg p-2 font-mono text-xs" data-testid="admin-invite-link">{link}</p>
    </div>
  );
}

/** Invitér en administrator (navn + e-mail). Linket vises kun i UI'et – aldrig i URL'en. */
export function AdminInviteForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<AdminInviteState, FormData>(inviteAdminAction, {});
  const v = state.values;
  return (
    <div>
      {state.ok && <p role="status" className="callout mb-3 text-sm" data-testid="admin-invited">{state.ok}</p>}
      {state.inviteLink && <InviteLink link={state.inviteLink} />}
      <form data-no-guard action={action} className="mt-3 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" key={state.at ?? 0} aria-busy={pending}>
        {state.error && <p role="alert" className="callout callout-error text-sm sm:col-span-3">{state.error}</p>}
        <div>
          <label className="label" htmlFor="admin-name">Navn</label>
          <input className="input" id="admin-name" name="name" required minLength={2} defaultValue={state.error ? v?.name : ""} disabled={disabled} />
        </div>
        <div>
          <label className="label" htmlFor="admin-email">E-mail</label>
          <input className="input" id="admin-email" name="email" type="email" required defaultValue={state.error ? v?.email : ""} disabled={disabled} />
        </div>
        <div>
          <button className="btn" type="submit" disabled={pending || disabled}>{pending ? "Inviterer …" : "Invitér administrator"}</button>
        </div>
      </form>
    </div>
  );
}

export function ResendAdminInviteButton({ userId, disabled }: { userId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<AdminInviteState, FormData>(resendAdminInviteAction, {});
  return (
    <div>
      <form data-no-guard action={action}>
        <input type="hidden" name="userId" value={userId} />
        <button className="btn-secondary btn-sm" type="submit" disabled={pending || disabled}>Send ny invitation</button>
      </form>
      {state.error && <p role="alert" className="mt-1 text-xs text-danger">{state.error}</p>}
      {state.ok && <p role="status" className="mt-1 text-xs text-muted">{state.ok}</p>}
      {state.inviteLink && <InviteLink link={state.inviteLink} />}
    </div>
  );
}
