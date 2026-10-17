/**
 * Resultat fra en server action brugt med useActionState (plan #22): beskeden vises på siden (ikke i URL'en), og de
 * indtastede værdier sendes tilbage, så felterne ikke tømmes ved en fejl.
 */
export interface FormState {
  ok?: string;
  error?: string;
  values?: Record<string, string>;
  /** Tidsstempel for svaret: bruges som React-key, så formularen nulstilles efter gem og genudfyldes efter en fejl */
  at?: number;
}

export const EMPTY_FORM_STATE: FormState = {};

/** Tekstværdier fra formularen (filer og adgangskoder udelades). */
export function formValues(formData: FormData, omit: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v !== "string" || omit.includes(k) || k.startsWith("$ACTION")) continue;
    out[k] = v.slice(0, 5000);
  }
  return out;
}
