/**
 * Telefonnumre til SMS: normaliseres til E.164 (+4520304050).
 * 8 cifre (evt. med +45/0045) er danske numre; andre numre skal have landekode (+ eller 00).
 */
export function toE164(input: string | null | undefined, defaultCountryCode = "45"): string | null {
  if (!input) return null;
  const t = input.trim().replace(/[\s().-]/g, "");
  if (!t) return null;
  let digits: string;
  if (t.startsWith("+")) digits = t.slice(1);
  else if (t.startsWith("00")) digits = t.slice(2);
  else if (/^\d{8}$/.test(t)) digits = defaultCountryCode + t;
  else return null;
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  if (digits.startsWith("45") && digits.length !== 10) return null;
  return `+${digits}`;
}

/** Til visning: +4520304050 -> +45 20 30 40 50 (andre lande uændret). */
export function formatPhone(e164: string): string {
  const m = /^\+45(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+45 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}
