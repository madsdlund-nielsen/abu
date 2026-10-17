/**
 * Ordmærket "pipe divide": advisory board | unlimited. Levende tekst i Open Sans Light (300), små bogstaver.
 * Farvefordeling (manual s. 3): "advisory board" er navy på lyst og hvid på mørkt; pipen og "unlimited" er altid guld.
 *
 * Proportioner målt i manualens enheder (s. 4), omregnet til em (skrifthøjde ascender->descender = 64,56 enheder = 1 em):
 *   mellemrum 60,2 enh. = 0,93 em på hver side · pipe 2,75 enh. = 0,043 em bred, spænder hele blækhøjden
 *   (ascender til descender: 0,76 em over og 0,24 em under grundlinjen). Låsen er 12,4 : 1.
 * Brug aldrig versaler, anden farvefordeling, skygge, rotation eller strakt skala.
 */
export function Logo({
  variant = "light",
  className = "",
  as: Tag = "span",
}: {
  /** light = navy tekst til lyse flader, dark = hvid tekst til charcoal/navy */
  variant?: "light" | "dark";
  /** Størrelsen styres med font-size (fx text-[22px]); resten skalerer i em. */
  className?: string;
  as?: "span" | "div";
}) {
  return (
    <Tag
      className={`inline-block select-none whitespace-nowrap font-light leading-none ${className}`}
      style={{ fontWeight: 300, textTransform: "none", letterSpacing: 0 }}
      role="img"
      aria-label="advisory board unlimited"
    >
      <span aria-hidden="true" className={variant === "dark" ? "text-white" : "text-navy"}>
        advisory board
      </span>
      <span
        aria-hidden="true"
        className="inline-block bg-gold align-baseline"
        style={{
          width: "max(1px, 0.043em)",
          height: "1em",
          margin: "0 0.93em",
          verticalAlign: "-0.24em",
        }}
      />
      <span aria-hidden="true" className="text-gold">
        unlimited
      </span>
    </Tag>
  );
}
