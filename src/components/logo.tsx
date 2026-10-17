/**
 * Officielt ordmærke (lockup 22, "advisory board | unlimited") som SVG med tekst i outline.
 * - light = navy udgave til lyse flader, dark = hvid udgave til charcoal/navy flader.
 * - Frirum: hele ordmærkets x-højde, ca. 4,3 % af bredden, på alle sider.
 * - Mindstebredde 300 px (manualen). Under 360 px viewport vises i stedet ab|u-ikonet (SemiBold, 32-96 px).
 * - Lockup 03 ("open tracking") er ikke godkendt i manualen og bruges ikke.
 */
const RATIO = 817 / 81; // viewBox for lockup 22
export const LOGO_MIN_WIDTH = 300;
const CLEAR_SPACE = 0.043;
const ICON_SIZE = 48;

export function Logo({
  variant = "light",
  width = LOGO_MIN_WIDTH,
  className = "",
  /** Tillad ikonet på smalle skærme (under 360 px). Slås fra, hvor ordmærket altid skal vises. */
  compact = true,
}: {
  /** light = navy tekst til lyse flader, dark = hvid tekst til charcoal/navy */
  variant?: "light" | "dark";
  /** Ordmærkets bredde i px (mindst 300) */
  width?: number;
  className?: string;
  compact?: boolean;
}) {
  const w = Math.max(LOGO_MIN_WIDTH, width);
  const h = Math.round(w / RATIO);
  const pad = Math.round(w * CLEAR_SPACE);
  const suffix = variant === "dark" ? "hvid" : "navy";
  const alt = "Advisory Board Unlimited";
  return (
    // Frirummet lægges som padding om selve logoet; det venstre frirum trækkes fra marginen, så logoet flugter med sidens indhold.
    <span className={`inline-flex select-none items-center ${className}`} style={{ marginLeft: -pad }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/brand/abu-lockup-22_${suffix}.svg`}
        width={w}
        height={h}
        alt={alt}
        style={{ padding: pad, boxSizing: "content-box", maxWidth: "none" }}
        className={compact ? "hidden min-[360px]:block" : "block"}
      />
      {compact && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/brand/abu-ikon_${suffix}.svg`}
          width={ICON_SIZE}
          height={ICON_SIZE}
          alt={alt}
          style={{ padding: Math.round(ICON_SIZE * CLEAR_SPACE) }}
          className="block min-[360px]:hidden"
        />
      )}
    </span>
  );
}
