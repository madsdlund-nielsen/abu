export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;
  return (
    <div
      role={err ? "alert" : "status"}
      className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
        err ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      {err ?? ok}
    </div>
  );
}

export type SP = Promise<Record<string, string | string[] | undefined>>;

export async function flashFrom(sp: SP) {
  const p = await sp;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return { ok: one(p.ok), err: one(p.err), params: p, one };
}
