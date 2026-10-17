import type { Metadata } from "next";
import { Empty } from "@/components/ui";
import { CONSENT_LABEL, loadLeads, parseLeadFilter, STATUS_LABEL, type LeadConsent, type LeadStatus, consentVersionLabel } from "@/lib/leads-admin";
import { formatPhone, toE164 } from "@/lib/phone";
import { formatDateTime } from "@/lib/time";
import type { SP } from "@/components/flash";

export const metadata: Metadata = { title: "Leads" };

const CONSENT_BADGE: Record<LeadConsent, string> = { ja: "badge-navy", trukket: "badge-gold", nej: "badge-muted" };
const STATUS_BADGE: Record<LeadStatus, string> = { igang: "badge-outline", gennemfoert: "badge-navy", udloebet: "badge-muted" };

export default async function AdminLeads({ searchParams }: { searchParams: SP }) {
  const params = await searchParams;
  const filter = parseLeadFilter(params);
  const rows = await loadLeads(filter);
  const qs = new URLSearchParams();
  if (filter.status) qs.set("status", filter.status);
  if (filter.consent) qs.set("samtykke", filter.consent);
  if (filter.q) qs.set("q", filter.q);
  const consented = rows.filter((r) => r.consent === "ja").length;

  return (
    <div>
      <span className="eyebrow">Admin · Salg</span>
      <h1>Leads</h1>
      <p className="mb-space-4 mt-space-3 max-w-3xl text-muted">
        Alle, der har udfyldt trin 1 i onboardingen, også dem der aldrig gjorde tilmeldingen færdig. Du kan kun kontakte leads med aktivt samtykke.
        Leads uden samtykke slettes automatisk, når tilmeldingen udløber.
      </p>

      <form method="get" className="mb-space-3 grid gap-3 border border-grey-bg bg-white p-space-3 sm:grid-cols-[1fr_12rem_12rem_auto] sm:items-end" role="search" aria-label="Filtrér leads">
        <div>
          <label className="label" htmlFor="q">Søg</label>
          <input className="input" id="q" name="q" type="search" defaultValue={filter.q} placeholder="Navn eller e-mail" />
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select className="input" id="status" name="status" defaultValue={filter.status}>
            <option value="">Alle</option>
            {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="samtykke">Samtykke</label>
          <select className="input" id="samtykke" name="samtykke" defaultValue={filter.consent}>
            <option value="">Alle</option>
            {(Object.keys(CONSENT_LABEL) as LeadConsent[]).map((k) => <option key={k} value={k}>{CONSENT_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button className="btn" type="submit">Filtrér</button>
          <a className="btn-secondary" href="/admin/leads">Nulstil</a>
        </div>
      </form>

      <div className="mb-space-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted" data-testid="lead-count">
          <span className="font-semibold text-navy">{rows.length}</span> {rows.length === 1 ? "lead" : "leads"} · <span className="font-semibold text-navy">{consented}</span> med samtykke
        </p>
        <a className="btn-secondary btn-sm" href={`/api/admin/leads${qs.size ? `?${qs}` : ""}`} download data-testid="lead-export">Eksportér CSV</a>
      </div>

      {rows.length === 0 ? (
        <Empty>Ingen leads matcher filtrene.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table" data-testid="leads-table">
            <thead>
              <tr><th>Lead</th><th>Trin</th><th>Status</th><th>Samtykke</th><th>Seneste aktivitet</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-lead={r.email}>
                  <td>
                    <p className="font-semibold text-navy">{r.name}</p>
                    <p className="text-xs text-muted break-all">{r.email}{r.phone && toE164(r.phone) ? ` · ${formatPhone(toE164(r.phone)!)}` : ""}</p>
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="tabular-nums">{r.step}/6</span>
                    <span className="ml-2 inline-flex gap-0.5 align-middle" aria-hidden="true">
                      {[1, 2, 3, 4, 5, 6].map((n) => <span key={n} className={`h-2 w-2 ${n <= r.step ? "bg-navy" : "bg-grey-bg"}`} />)}
                    </span>
                  </td>
                  <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                  <td>
                    <span className={`badge ${CONSENT_BADGE[r.consent]}`}>{CONSENT_LABEL[r.consent]}</span>
                    {r.channels.length > 0 && <p className="mt-1 text-xs text-muted">{r.channels.join(" + ")}</p>}
                    {r.consentedAt && <p className="text-xs text-muted">{formatDateTime(r.consentedAt)} · samtykketekst: {consentVersionLabel(r.consentVersion)}</p>}
                  </td>
                  <td className="whitespace-nowrap text-sm">{formatDateTime(r.lastActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
