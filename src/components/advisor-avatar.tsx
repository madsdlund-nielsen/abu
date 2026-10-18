import { avatarSizeFor, avatarSrc } from "@/lib/avatar-url";

const SIZES = {
  sm: { px: 36, box: "h-9 w-9", text: "text-xs" },
  md: { px: 48, box: "h-12 w-12", text: "text-sm" },
  lg: { px: 160, box: "h-40 w-40", text: "text-4xl font-light" },
} as const;

export type AdvisorAvatarSize = keyof typeof SIZES;

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
}

/**
 * Rådgiverens foto eller initialer i en firkantet flade (radius 0 overalt). Fotoet hentes fra appen selv
 * (`/api/avatar/<id>`, versioneret URL); små visninger bruger 96 px-miniaturen. `photo` er versionen fra
 * `visibleAvatarVersion` – null/udeladt = initialer (intet billede, eller seeren må ikke se det).
 */
export function AdvisorAvatar({ advisorId, name, photo, size = "md", className = "" }: { advisorId: string; name: string; photo?: string | null; size?: AdvisorAvatarSize; className?: string }) {
  const s = SIZES[size];
  if (photo) {
    return (
      // Almindeligt <img> med faste mål: billedet er allerede beskåret og skaleret på serveren (512/96 px WebP)
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarSrc(advisorId, photo, avatarSizeFor(s.px))}
        alt={name}
        width={s.px}
        height={s.px}
        loading="lazy"
        decoding="async"
        className={`${s.box} shrink-0 bg-grey-bg object-cover ${className}`}
        data-testid="advisor-avatar"
        data-photo="true"
      />
    );
  }
  // Navnet står altid ved siden af initialerne, så de er pynt for skærmlæsere
  return (
    <span
      className={`flex ${s.box} shrink-0 items-center justify-center bg-navy ${s.text} font-semibold uppercase text-white ${className}`}
      aria-hidden="true"
      data-testid="advisor-avatar"
      data-photo="false"
    >
      {initialsOf(name)}
    </span>
  );
}
