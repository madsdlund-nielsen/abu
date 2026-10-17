/**
 * Samtykke til optagelse og transskription. Teksten og versionen ligger i CMS'et (onboarding-tekster, nøglen
 * step6.recordingConsent); `recordingConsentVersion` på brugeren peger på den version, brugeren accepterede.
 */

/** Felter til prisma.user.create/update, når samtykket gives nu. */
export function recordingConsentNow(version: string, now = new Date()) {
  return { recordingConsentAt: now, recordingConsentVersion: version };
}

/** Må brugeren deltage i optagne møder? */
export function hasRecordingConsent(user: { recordingConsentAt: Date | null }): boolean {
  return user.recordingConsentAt !== null;
}

/**
 * Kun relative stier inden for appen må bruges som "næste"-adresse efter login/samtykke (ingen open redirect):
 * ingen anden origin, intet "//" eller "\\", ingen kontroltegn, og ikke login-siden selv (løkke).
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || next.length > 2000) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f\u007f]|%0[0-9a-f]|%1[0-9a-f]|%7f/i.test(next)) return null;
  try {
    const base = "http://abu.invalid";
    const u = new URL(next, base);
    if (u.origin !== base) return null;
    if (u.pathname === "/login" || u.pathname.startsWith("/api/")) return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

/** Login-adresse med "næste"-sti (dybe links fra fx påmindelser overlever login, QA plan #21). */
export function loginUrlFor(next: string | null | undefined): string {
  const safe = safeNextPath(next);
  return safe && safe !== "/" ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}
