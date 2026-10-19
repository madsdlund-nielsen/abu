import type { ReadinessItem } from "@/lib/advisor-readiness";

/** Tjekliste til aktivering: ✓ opfyldt, ! mangler, – valgfrit og ikke udfyldt. Aktivering er blokeret, indtil alle påkrævede punkter er opfyldt. */
export function ReadinessList({ items, compact = false }: { items: ReadinessItem[]; compact?: boolean }) {
  return (
    <ul className={compact ? "mt-1 space-y-0.5 text-xs" : "mt-2 space-y-1 text-sm"} aria-label="Klar til aktivering" data-testid="readiness">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-2" data-ok={i.ok} data-optional={i.optional ? "true" : undefined}>
          <span
            aria-hidden="true"
            className={`inline-flex h-4 w-4 shrink-0 items-center justify-center text-[10px] font-bold ${i.ok ? "bg-navy text-white" : i.optional ? "border border-slate text-muted" : "border border-danger text-danger"}`}
          >
            {i.ok ? "✓" : i.optional ? "–" : "!"}
          </span>
          <span className={i.ok ? "text-ink" : i.optional ? "text-muted" : "font-semibold text-danger"}>
            {i.label}
            <span className="sr-only">{i.ok ? ": opfyldt" : i.optional ? ": ikke udfyldt (blokerer ikke aktivering)" : ": mangler"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Kompakt indikator til listen: «Klar 5/5» eller «Mangler 2 af 5: …». */
export function ReadinessSummary({ items: all, id }: { items: ReadinessItem[]; id?: string }) {
  // Kun påkrævede punkter tæller (profilbilledet er valgfrit)
  const items = all.filter((i) => !i.optional);
  const missing = items.filter((i) => !i.ok);
  const done = items.length - missing.length;
  if (missing.length === 0) {
    return (
      <p id={id} className="mt-1 text-xs font-semibold text-navy" data-testid="readiness-summary" data-ready="true">
        <span aria-hidden="true" className="mr-1">✓</span>Tjekliste opfyldt ({done}/{items.length})
      </p>
    );
  }
  return (
    <p id={id} className="mt-1 text-xs text-danger" data-testid="readiness-summary" data-ready="false">
      <span className="font-semibold">Tjekliste {done}/{items.length}.</span> Mangler: {missing.map((i) => i.label.charAt(0).toLowerCase() + i.label.slice(1)).join(", ")}
    </p>
  );
}

/**
 * Gemt status (altid databasens tilstand, aldrig en ugemt formular): AKTIV eller INAKTIV. En aktiv rådgiver, der ikke
 * længere opfylder tjeklisten, vises som «Aktiv – mangler: …», så admin kan handle (ingen automatisk deaktivering).
 */
export function AdvisorStatusBadge({ active, missing }: { active: boolean; missing: string[] }) {
  if (active && missing.length > 0) {
    return (
      <span className="badge badge-danger" data-testid="advisor-status" data-status="active-missing">
        Aktiv – mangler: {missing.join(", ")}
      </span>
    );
  }
  return (
    <span className={`badge ${active ? "badge-navy" : "badge-outline"}`} data-testid="advisor-status" data-status={active ? "active" : "inactive"}>
      {active ? "Aktiv" : "Inaktiv"}
    </span>
  );
}
