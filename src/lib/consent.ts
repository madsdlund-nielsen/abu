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

/** Kun relative stier inden for appen må bruges som "næste"-adresse efter samtykke. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  return next;
}
