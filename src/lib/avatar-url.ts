/**
 * Billed-URL'er til rådgiverfotos (kan bruges i både server- og klientkomponenter – ingen sharp/Prisma her).
 *
 * Billedet serveres af appen selv fra det private lager: `GET /api/avatar/<rådgiver-id>?size=512|96&v=<version>`.
 * Versionen er tidspunktet for seneste upload (base 36), så URL'en skifter ved hvert nyt billede. Svaret caches kort og
 * genvalideres (se `avatar-serve.ts`), så et fjernet billede ikke bliver hængende i caches.
 */
export const AVATAR_SIZE = 512;
export const AVATAR_THUMB_SIZE = 96;
export type AvatarSize = typeof AVATAR_SIZE | typeof AVATAR_THUMB_SIZE;

/** Version til URL'en ud fra `photoUpdatedAt`. Null = intet billede. */
export function avatarVersion(photoUpdatedAt: Date | null | undefined): string | null {
  return photoUpdatedAt ? photoUpdatedAt.getTime().toString(36) : null;
}

/** Små visninger (≤ 96 px, også på 2x-skærme op til 48 px) bruger miniaturen. */
export function avatarSizeFor(displayPx: number): AvatarSize {
  return displayPx * 2 <= AVATAR_THUMB_SIZE ? AVATAR_THUMB_SIZE : AVATAR_SIZE;
}

export function avatarSrc(advisorId: string, version: string, size: AvatarSize): string {
  return `/api/avatar/${encodeURIComponent(advisorId)}?size=${size}&v=${encodeURIComponent(version)}`;
}

/**
 * Må seeren se fotoet? Aktive rådgiveres fotos er offentlige (de vises i onboarding-kataloget før login).
 * Inaktive rådgiveres fotos ser kun admin og rådgiveren selv. Bruges af ruten og af siderne, så en inaktiv rådgiver
 * aldrig får et billede, der svarer 404, men vises med initialer.
 */
export function canViewAvatar(advisor: { id: string; active: boolean }, viewer: { id: string; role: string } | null | undefined): boolean {
  if (advisor.active) return true;
  if (!viewer) return false;
  return viewer.role === "ADMIN" || viewer.id === advisor.id;
}

/** Versionen, hvis seeren må se fotoet – ellers null (initialer). */
export function visibleAvatarVersion(
  advisor: { id: string; active: boolean; photoKey: string | null; photoUpdatedAt: Date | null },
  viewer: { id: string; role: string } | null | undefined,
): string | null {
  if (!advisor.photoKey || !canViewAvatar(advisor, viewer)) return null;
  return avatarVersion(advisor.photoUpdatedAt);
}

/** Miniaturens lagernøgle: `avatars/<id>/<tilfældig>.webp` → `…-96.webp`. */
export function thumbKeyFor(key: string): string {
  return key.replace(/\.webp$/, `-${AVATAR_THUMB_SIZE}.webp`);
}

/** Begge objekter for et gemt billede (til sletning og dataeksport). */
export function avatarObjectKeys(photoKey: string | null | undefined): string[] {
  return photoKey ? [photoKey, thumbKeyFor(photoKey)] : [];
}
