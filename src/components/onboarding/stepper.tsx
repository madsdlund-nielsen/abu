import Link from "next/link";

export const STEP_LABELS = ["Kontakt", "Virksomhed", "Bekræft", "Test", "Dit board", "Konto & betaling"] as const;

/**
 * Trinindikator: på bredde en rolig række af firkantede tal med en tynd linje imellem; på mobil "Trin n af 6" og en
 * segmenteret fremdriftslinje. Gennemførte trin er links tilbage.
 */
export function Stepper({ current, reached }: { current: number; reached: number }) {
  return (
    <nav aria-label="Fremdrift" className="mb-space-5">
      <ol className="hidden sm:flex">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const isCurrent = n === current;
          const done = n < current;
          const reachable = n <= reached && !isCurrent;
          const box = (
            <>
              <span
                className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center border text-sm font-semibold ${
                  isCurrent ? "border-navy bg-navy text-white" : done ? "border-navy bg-white text-navy" : "border-slate bg-white text-slate"
                }`}
                aria-hidden="true"
              >
                {done ? "✓" : n}
              </span>
              <span
                className={`mt-2 block text-center text-xs uppercase tracking-wide ${
                  isCurrent ? "font-bold text-navy" : done ? "font-semibold text-navy" : "text-muted"
                }`}
              >
                {label}
              </span>
              {isCurrent && <span className="mt-1 block h-0.5 w-8 bg-gold" aria-hidden="true" />}
            </>
          );
          return (
            <li key={label} className="relative flex flex-1" aria-current={isCurrent ? "step" : undefined}>
              {n < STEP_LABELS.length && <span className={`absolute left-1/2 top-4 h-px w-full ${done ? "bg-navy" : "bg-slate/40"}`} aria-hidden="true" />}
              {reachable ? (
                <Link href={`/kom-i-gang?trin=${n}`} className="flex w-full flex-col items-center no-underline hover:no-underline" aria-label={`Trin ${n}: ${label}`}>
                  {box}
                </Link>
              ) : (
                <div className="flex w-full flex-col items-center">{box}</div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="sm:hidden">
        <p className="text-xs font-bold uppercase tracking-wide text-navy">
          Trin {current} af {STEP_LABELS.length} · <span className="text-muted">{STEP_LABELS[current - 1]}</span>
        </p>
        <div className="mt-2 grid grid-cols-6 gap-1" aria-hidden="true">
          {STEP_LABELS.map((l, i) => (
            <span key={l} className={`h-1 ${i + 1 <= current ? "bg-navy" : "bg-slate/40"}`} />
          ))}
        </div>
      </div>
    </nav>
  );
}
