import type { ReadinessItem } from "@/lib/advisor-readiness";

/** Tjekliste ved «Aktivér»: ✓ opfyldt, ! mangler (advarsel, blokerer ikke). */
export function ReadinessList({ items, compact = false }: { items: ReadinessItem[]; compact?: boolean }) {
  return (
    <ul className={compact ? "mt-1 space-y-0.5 text-xs" : "mt-2 space-y-1 text-sm"} aria-label="Klar til aktivering" data-testid="readiness">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-2" data-ok={i.ok}>
          <span aria-hidden="true" className={`inline-flex h-4 w-4 shrink-0 items-center justify-center text-[10px] font-bold ${i.ok ? "bg-navy text-white" : "border border-danger text-danger"}`}>
            {i.ok ? "✓" : "!"}
          </span>
          <span className={i.ok ? "text-ink" : "font-semibold text-danger"}>
            {i.label}
            <span className="sr-only">{i.ok ? ": opfyldt" : ": mangler"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
