export interface RuleSpan {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/** Overlapper (eller dubletter) det nye tidsrum et eksisterende på samme ugedag? Tidsrum, der blot støder op til hinanden, er ok. */
export function overlapsExistingRule(existing: RuleSpan[], next: RuleSpan): boolean {
  return existing.some((r) => r.weekday === next.weekday && next.startMinute < r.endMinute && r.startMinute < next.endMinute);
}
