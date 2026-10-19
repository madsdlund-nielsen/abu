"use client";

import { useActionState, useId, useRef, useState } from "react";
import { setAdvisorActiveAction, type ActivationState } from "@/app/actions/admin";
import { ConfirmDialog } from "@/components/cms/primitives";

/**
 * Dedikeret knap til aktivering/deaktivering (QA #13). Gemmer straks via sin egen server action efter en bekræftelse.
 * «Aktivér» er deaktiveret med en forklaring, indtil tjeklisten er opfyldt (serveren afviser det også). «Deaktivér» er
 * altid mulig; bekræftelsen viser de kunder, hvis aktive boards rådgiveren sidder i.
 */
export function AdvisorActivationControl({
  userId,
  name,
  active,
  missing,
  boards,
  compact = false,
}: {
  userId: string;
  name: string;
  /** Gemt tilstand i databasen */
  active: boolean;
  /** Manglende punkter på tjeklisten (gemt tilstand) */
  missing: string[];
  /** Kunder med et aktivt board, som rådgiveren sidder i */
  boards: string[];
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState<ActivationState, FormData>(setAdvisorActiveAction, {});
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const helpId = useId();
  const blocked = !active && missing.length > 0;
  const sm = compact ? "btn-sm" : "";
  const label = active ? (compact ? "Deaktivér" : "Deaktivér rådgiver") : compact ? "Aktivér" : "Aktivér rådgiver";
  const pendingLabel = active ? "Deaktiverer …" : "Aktiverer …";

  return (
    <div className={compact ? "flex flex-col items-end" : ""} data-testid="activation-control">
      <form ref={formRef} data-no-guard action={action} aria-busy={pending}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="active" value={active ? "false" : "true"} />
        <button
          type="button"
          className={`${active ? "btn-secondary" : "btn"} ${sm}`}
          disabled={blocked || pending}
          aria-describedby={blocked ? helpId : undefined}
          aria-label={compact ? `${label} ${name}` : undefined}
          onClick={() => setConfirming(true)}
          data-testid={active ? "deactivate-button" : "activate-button"}
        >
          {pending ? pendingLabel : label}
        </button>
      </form>
      {blocked && (
        <p id={helpId} className={`${compact ? "mt-1 max-w-[14rem] text-right text-xs" : "mt-2 text-sm"} text-muted`} data-testid="activate-blocked">
          {compact ? "Kan aktiveres, når tjeklisten er opfyldt." : <>Kan først aktiveres, når hele tjeklisten er opfyldt. Mangler: <span className="font-semibold text-danger">{missing.join(", ")}</span>.</>}
        </p>
      )}
      {state.error && (
        <p key={state.at} role="alert" className={compact ? "mt-1 max-w-[14rem] text-right text-xs text-danger" : "callout callout-error mt-space-3 text-sm"}>
          {state.error}
        </p>
      )}
      {state.ok && (
        <p key={state.at} role="status" className={compact ? "mt-1 max-w-[14rem] text-right text-xs text-navy" : "callout mt-space-3 text-sm"} data-testid="activation-result">
          {state.ok}
        </p>
      )}

      <ConfirmDialog
        open={confirming}
        title={active ? `Deaktivér ${name}?` : `Aktivér ${name}?`}
        confirmLabel={active ? "Deaktivér rådgiver" : "Aktivér rådgiver"}
        danger={active}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          formRef.current?.requestSubmit();
        }}
      >
        {active ? (
          boards.length > 0 ? (
            <div data-testid="deactivate-boards">
              <p>{name} sidder i aktive boards hos:</p>
              <ul className="mt-2 list-disc pl-5 text-ink">
                {boards.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <p className="mt-2">Kunderne kan ikke booke nye møder, før rådgiveren er erstattet under Abonnementer. Allerede bookede møder ændres ikke. Er rådgiveren ansvarlig rådgiver for et board, tildeles en ny automatisk.</p>
            </div>
          ) : (
            <p>{name} sidder ikke i nogen aktive boards. Rådgiveren fjernes fra kataloget og kan ikke vælges af kunder, før du aktiverer igen.</p>
          )
        ) : (
          <p>Tjeklisten er opfyldt. {name} bliver synlig i kataloget og kan vælges af kunder med det samme.</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
