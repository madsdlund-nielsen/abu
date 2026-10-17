"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listLogsAction, resendLogAction } from "@/app/actions/notifications";
import type { CmsLogFilter, CmsLogRow } from "@/lib/notifications/cms-types";
import { TRIGGERS } from "@/lib/notifications/triggers";
import { formatDateTime } from "@/lib/time";
import { StatusBadge, STATUS_LABEL } from "./shared";
import type { NotificationStatus } from "@prisma/client";

export function LogTab() {
  const [filter, setFilter] = useState<CmsLogFilter>({ status: "", channel: "", trigger: "", q: "" });
  const [rows, setRows] = useState<CmsLogRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (f: CmsLogFilter, cursor?: string | null) => {
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    const r = await listLogsAction(f, cursor);
    if (my !== seq.current) return;
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setRows((prev) => (cursor ? [...prev, ...r.page.rows] : r.page.rows));
    setNext(r.page.nextCursor);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(filter), filter.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [filter, load]);

  async function resend(row: CmsLogRow) {
    setNotice(null);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: "QUEUED", error: null, canResend: false } : r)));
    const r = await resendLogAction(row.id);
    if (r.ok) setNotice(`Beskeden til ${row.recipient} er sendt igen.`);
    else setError(r.error);
    void load(filter);
  }

  const set = (p: Partial<CmsLogFilter>) => setFilter((f) => ({ ...f, ...p }));

  return (
    <div>
      <form className="mb-space-3 grid gap-3 border border-grey-bg bg-white p-space-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_9rem_14rem_auto] lg:items-end" role="search" aria-label="Filtrér log" onSubmit={(e) => e.preventDefault()}>
        <div>
          <label className="label" htmlFor="log-q">Søg</label>
          <input id="log-q" className="input" type="search" value={filter.q} onChange={(e) => set({ q: e.target.value })} placeholder="Modtager eller skabelon" />
        </div>
        <div>
          <label className="label" htmlFor="log-status">Status</label>
          <select id="log-status" className="input" value={filter.status} onChange={(e) => set({ status: e.target.value as NotificationStatus | "" })}>
            <option value="">Alle</option>
            {(Object.keys(STATUS_LABEL) as NotificationStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="log-channel">Kanal</label>
          <select id="log-channel" className="input" value={filter.channel} onChange={(e) => set({ channel: e.target.value as "EMAIL" | "SMS" | "" })}>
            <option value="">Alle</option>
            <option value="EMAIL">E-mail</option>
            <option value="SMS">SMS</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="log-trigger">Udløser</label>
          <select id="log-trigger" className="input" value={filter.trigger} onChange={(e) => set({ trigger: e.target.value })}>
            <option value="">Alle</option>
            {Object.values(TRIGGERS).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            <option value="test">Test fra CMS</option>
          </select>
        </div>
        <button type="button" className="btn-secondary" onClick={() => void load(filter)}>Opdatér</button>
      </form>

      <div aria-live="polite">
        {notice && <p className="callout mb-space-3 text-sm" role="status">{notice}</p>}
        {error && <p className="callout callout-error mb-space-3 text-sm" role="alert">{error}</p>}
      </div>

      {rows.length === 0 && !loading ? (
        <p className="border border-dashed border-slate bg-white p-space-5 text-center text-muted">Ingen beskeder matcher filtrene.</p>
      ) : (
        <div className="table-wrap">
          <table className="table" data-testid="log-table">
            <thead>
              <tr><th>Tidspunkt</th><th>Besked</th><th>Modtager</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid="log-row" data-status={r.status} data-trigger={r.trigger} data-template={r.templateKey}>
                  <td className="whitespace-nowrap text-sm">
                    {formatDateTime(new Date(r.sentAt ?? r.scheduledFor))}
                    {r.status === "QUEUED" && <p className="text-xs text-muted">planlagt</p>}
                  </td>
                  <td className="min-w-[12rem]">
                    <p className="text-sm font-semibold text-navy">{r.triggerLabel}</p>
                    <p className="text-xs text-muted">{r.channel === "SMS" ? "SMS" : "E-mail"} · {r.templateKey}</p>
                    {(r.subject || r.preview) && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-muted">Vis tekst</summary>
                        {r.subject && <p className="mt-1 font-semibold text-navy">{r.subject}</p>}
                        {r.preview && <p className="mt-1 whitespace-pre-wrap text-ink">{r.preview}</p>}
                      </details>
                    )}
                  </td>
                  <td className="break-all text-sm">{r.recipient}</td>
                  <td>
                    <StatusBadge status={r.status} />
                    {r.error && <p className="mt-1 max-w-[16rem] text-xs text-muted">{r.error}</p>}
                  </td>
                  <td className="text-right">
                    {r.canResend && <button type="button" className="btn-secondary btn-sm" onClick={() => void resend(r)} aria-label={`Send igen til ${r.recipient}`}>Send igen</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-space-3 flex items-center justify-between text-sm text-muted">
        <span>{loading ? "Henter …" : `${rows.length} ${rows.length === 1 ? "besked" : "beskeder"} vist`}</span>
        {next && <button type="button" className="btn-secondary btn-sm" onClick={() => void load(filter, next)} disabled={loading}>Vis flere</button>}
      </div>
    </div>
  );
}
