import type { Metadata } from "next";
import Link from "next/link";
import { applyBalancingAction } from "@/app/actions/admin-meetings";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { leadCounts, leadSpread, loadLeadOverview, proposeBalancing } from "@/lib/lead";

export const metadata: Metadata = { title: "Ansvarlige rådgivere" };

/** Fordeling af ansvarsroller, boards uden ansvarlig og et udligningsforslag, der kun anvendes efter bekræftelse. */
export default async function LeadOverviewPage({ searchParams }: { searchParams: SP }) {
  const { ok, err } = await flashFrom(searchParams);
  const sp = await searchParams;
  const showProposal = sp.forslag === "1";
  const o = await loadLeadOverview();
  const max = Math.max(1, ...o.advisors.map((a) => a.leadCount));
  const spread = leadSpread(leadCounts(o.boards, o.advisors.filter((a) => a.active).map((a) => a.id)));
  const moves = showProposal ? proposeBalancing(o.boards) : [];
  const nameOf = (id: string) => o.advisors.find((a) => a.id === id)?.name ?? id;
  const after = leadCounts(
    o.boards.map((b) => ({ ...b, leadId: moves.find((m) => m.subscriptionId === b.subscriptionId)?.to ?? b.leadId })),
    o.advisors.filter((a) => a.active).map((a) => a.id),
  );

  return (
    <div className="space-y-space-4">
      <div>
        <span className="eyebrow">Admin · Rådgivere</span>
        <h1>Ansvarlige rådgivere</h1>
        <p className="mt-space-3 max-w-3xl text-muted">
          Hvert board har én ansvarlig rådgiver blandt rådgivere med det interne tag «Lead-kvalificeret». Nye boards får den kvalificerede med færrest
          ansvarsroller. Eksisterende boards omfordeles kun, når du selv bekræfter et udligningsforslag. Tagget sættes under <Link href="/admin/advisors">Rådgivere</Link>.
        </p>
      </div>
      <Flash ok={ok} err={err} />

      {o.withoutLead.length > 0 && (
        <section className="card" aria-labelledby="nolead-h" data-testid="boards-without-lead">
          <h2 id="nolead-h">Boards uden ansvarlig rådgiver</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {o.withoutLead.map((b) => (
              <li key={b.subscriptionId} className="callout callout-error">
                <Link href={`/admin/subscriptions/${b.subscriptionId}`} className="font-semibold">{b.label}</Link>
                <span className="text-ink"> – {b.hasEligible ? "vælg en ansvarlig" : "ingen i boardet er kvalificeret; tilføj en rådgiver med lead-tagget"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="dist-h">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="dist-h">Fordeling</h2>
          <p className="text-sm text-muted" data-testid="lead-spread">Forskel mellem flest og færrest: <span className="font-semibold text-navy">{spread}</span></p>
        </div>
        {o.advisors.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Ingen rådgivere har tagget «Lead-kvalificeret» endnu.</p>
        ) : (
          <div className="table-wrap mt-space-3">
            <table className="table" data-testid="lead-distribution">
              <thead>
                <tr><th>Rådgiver</th><th>Ansvarlig for</th><th className="!text-right">Pladser i boards</th></tr>
              </thead>
              <tbody>
                {o.advisors.map((a) => (
                  <tr key={a.id} data-advisor={a.name}>
                    <td>
                      <Link href={`/admin/advisors/${a.id}`} className="font-medium">{a.name}</Link>
                      {!a.active && <span className="badge badge-outline ml-2">Inaktiv</span>}
                    </td>
                    <td className="w-1/2">
                      <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 bg-grey-bg" role="presentation">
                          <div className="h-2 bg-navy" style={{ width: `${(a.leadCount / max) * 100}%` }} />
                        </div>
                        <span className="w-16 text-right text-sm tabular-nums" data-testid="lead-count">{a.leadCount} {a.leadCount === 1 ? "board" : "boards"}</span>
                      </div>
                    </td>
                    <td className="text-right tabular-nums">{a.seatCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="bal-h" data-testid="balancing">
        <h2 id="bal-h">Udligning</h2>
        <p className="mt-2 text-sm text-muted">
          Forslaget flytter så få ansvarsroller som muligt og kun til rådgivere, der allerede sidder i det pågældende board og er kvalificerede. Kunden og de to rådgivere får besked, når du anvender det.
        </p>
        {!showProposal ? (
          <Link href="/admin/ansvarlige?forslag=1" className="btn-secondary mt-space-3">Foreslå udligning</Link>
        ) : moves.length === 0 ? (
          <p className="callout mt-space-3 text-sm" data-testid="no-moves">Fordelingen kan ikke gøres jævnere inden for boardenes egne kvalificerede rådgivere.</p>
        ) : (
          <form action={applyBalancingAction} className="mt-space-3" data-confirm={`Anvend udligningen? ${moves.length} ${moves.length === 1 ? "board får" : "boards får"} en ny ansvarlig rådgiver, og der sendes besked.`}>
            <ul className="divide-y divide-grey-bg border border-grey-bg text-sm" data-testid="moves">
              {moves.map((m) => (
                <li key={m.subscriptionId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <input type="hidden" name="move" value={`${m.subscriptionId}:${m.from}:${m.to}`} />
                  <Link href={`/admin/subscriptions/${m.subscriptionId}`} className="font-semibold">{m.label}</Link>
                  <span>{nameOf(m.from)} <span aria-hidden="true">→</span><span className="sr-only">til</span> <span className="font-semibold text-navy">{nameOf(m.to)}</span></span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted">Forskel mellem flest og færrest efter udligning: <span className="font-semibold text-navy">{leadSpread(after)}</span> (nu {spread}).</p>
            <div className="mt-space-3 flex flex-wrap gap-3">
              <button className="btn" type="submit">Anvend udligning</button>
              <Link href="/admin/ansvarlige" className="btn-secondary">Annullér</Link>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
