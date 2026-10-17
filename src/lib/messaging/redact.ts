/**
 * Redigering af beskeder, før de skrives til en log (H-3). Engangslinks (nulstilling, invitation, afmelding), e-mailadresser
 * og telefonnumre må aldrig stå i serverloggen.
 */

/** mette.lindberg@firma.dk -> m***@firma.dk */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return "***";
  return `${address[0]}***${address.slice(at)}`;
}

/** +4520304050 -> +45******50 (landekode og to sidste cifre bevares til fejlsøgning) */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 6) return "***";
  const cc = phone.trim().startsWith("+") ? `+${digits.slice(0, 2)}` : digits.slice(0, 2);
  return `${cc}${"*".repeat(digits.length - 4)}${digits.slice(-2)}`;
}

export function maskAddress(address: string): string {
  return address.includes("@") ? maskEmail(address) : maskPhone(address);
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Telefonnumre: +45 20 30 40 50, 0045..., 20304050 (mindst 8 cifre, evt. med mellemrum/bindestreg)
const PHONE_RE = /(?:\+|\b00)?\d(?:[ -]?\d){7,14}\b/g;
/** Lange, tilfældigt udseende sti-segmenter (tokens) i en URL */
const TOKENISH = /^[A-Za-z0-9_-]{20,}$/;

function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname
      .split("/")
      .map((seg) => (TOKENISH.test(seg) ? "[fjernet]" : seg))
      .join("/");
    return `${u.origin}${path}${u.search ? "?[fjernet]" : ""}${u.hash ? "#[fjernet]" : ""}`;
  } catch {
    return "[link fjernet]";
  }
}

/** Fjerner forespørgsler/tokens fra links og maskerer e-mailadresser og telefonnumre i en tekst. */
export function redactText(text: string): string {
  const urls: string[] = [];
  // Links først (og parkeret), så tal i links ikke tolkes som telefonnumre
  const parked = text.replace(URL_RE, (m) => {
    urls.push(redactUrl(m));
    return `\u0000${urls.length - 1}\u0000`;
  });
  return parked
    .replace(EMAIL_RE, (m) => maskEmail(m))
    .replace(PHONE_RE, (m) => maskPhone(m))
    .replace(/\u0000(\d+)\u0000/g, (_, i) => urls[Number(i)]);
}
