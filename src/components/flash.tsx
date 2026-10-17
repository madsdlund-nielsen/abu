import { FlashCleaner } from "./flash-cleaner";

/** Besked efter en omdirigering (?ok=/?err=). Parametrene fjernes fra adressen, når beskeden er vist (plan #23). */
export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;
  return (
    <div role={err ? "alert" : "status"} className={`callout mb-space-4 text-sm ${err ? "callout-error" : ""}`}>
      {err ?? ok}
      <FlashCleaner />
    </div>
  );
}

export type SP = Promise<Record<string, string | string[] | undefined>>;

export async function flashFrom(sp: SP) {
  const p = await sp;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return { ok: one(p.ok), err: one(p.err), params: p, one };
}
