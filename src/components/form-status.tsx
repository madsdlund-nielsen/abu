import type { FormState } from "@/lib/form-state";

/** Besked fra en server action (useActionState). role=alert for fejl, status for OK. */
export function FormStatus({ state, className = "" }: { state: FormState; className?: string }) {
  if (!state.ok && !state.error) return null;
  return (
    <p role={state.error ? "alert" : "status"} className={`callout text-sm ${state.error ? "callout-error" : ""} ${className}`}>
      {state.error ?? state.ok}
    </p>
  );
}
