import type { ReactNode } from "react";

const TONE = {
  white: "band-white",
  grey: "band-grey",
  navy: "band-navy on-dark",
  charcoal: "band-charcoal on-dark",
} as const;

/** Sektionsbånd i den faste rytme hvid -> lysegrå -> navy -> hvid. Indholdet centreres i container-max (1160 px). */
export function Band({
  tone = "white",
  children,
  className = "",
  id,
  tight = false,
}: {
  tone?: keyof typeof TONE;
  children: ReactNode;
  className?: string;
  id?: string;
  /** Mindre lodret luft (til indholdssider i appen) */
  tight?: boolean;
}) {
  return (
    <section id={id} className={`${tight ? "py-space-5" : "band"} ${TONE[tone]} ${className}`}>
      <div className="container-abu">{children}</div>
    </section>
  );
}

/** Eyebrow + tynd overskrift + kort guldstreg, som i manualen. */
export function SectionHeading({
  eyebrow,
  title,
  children,
  as: Tag = "h2",
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  as?: "h1" | "h2";
}) {
  return (
    <div className="max-w-3xl">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <Tag className="section-title">{title}</Tag>
      <span className="rule-gold mt-5" aria-hidden="true" />
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}

/** Sidetitel i appen: tynd navy overskrift med guldstreg. */
export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1>{children}</h1>
      <span className="rule-gold mt-4" aria-hidden="true" />
      {sub && <p className="mt-4 max-w-3xl text-muted">{sub}</p>}
    </div>
  );
}
