import type { Metadata } from "next";
import { addBlockAction, addRuleAction, deleteBlockAction, deleteRuleAction } from "@/app/actions/advisor";
import { DateTimeField, TimeSelect } from "@/components/date-time-field";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, minutesToHHMM, WEEKDAY_NAMES } from "@/lib/time";

export const metadata: Metadata = { title: "Tilgængelighed" };

export default async function AvailabilityPage({ searchParams }: { searchParams: SP }) {
  const user = await requireRole("ADVISOR");
  const { ok, err } = await flashFrom(searchParams);
  const [rules, blocks] = await Promise.all([
    prisma.availabilityRule.findMany({ where: { advisorId: user.id }, orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] }),
    prisma.availabilityBlock.findMany({
      where: { advisorId: user.id, endsAt: { gt: new Date() } },
      orderBy: { startsAt: "asc" },
    }),
  ]);
  return (
    <div className="space-y-6">
      <h1>Tilgængelighed</h1>
      <p className="text-muted">Alle tider er dansk tid (Europe/Copenhagen). Datoer skrives som dd.mm.åååå og klokkeslæt i 24-timers format. Kunder kan kun booke tider, der ligger helt inde i et af dine tidsrum.</p>
      <Flash ok={ok} err={err} />

      <section className="card">
        <h2>Faste ugentlige tidsrum</h2>
        {rules.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Ingen tidsrum endnu.</p>
        ) : (
          <ul className="mt-3 divide-y divide-grey-bg text-sm">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <span><strong className="inline-block w-24">{WEEKDAY_NAMES[r.weekday]}</strong> {minutesToHHMM(r.startMinute)}–{minutesToHHMM(r.endMinute)}</span>
                <form action={deleteRuleAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="btn-danger btn-sm" type="submit">Fjern</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addRuleAction} className="mt-5 grid gap-3 sm:grid-cols-4">
          <div>
            <label className="label" htmlFor="weekday">Ugedag</label>
            <select className="input" id="weekday" name="weekday" defaultValue="1">
              {WEEKDAY_NAMES.slice(1).map((n, i) => (
                <option key={n} value={i + 1}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="start">Fra</label>
            <TimeSelect id="start" name="start" defaultValue="09:00" />
          </div>
          <div>
            <label className="label" htmlFor="end">Til</label>
            <TimeSelect id="end" name="end" defaultValue="16:00" allowEndOfDay />
          </div>
          <div className="flex items-end"><button className="btn w-full" type="submit">Tilføj</button></div>
        </form>
      </section>

      <section className="card">
        <h2>Fravær og blokerede perioder</h2>
        {blocks.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Ingen kommende blokeringer.</p>
        ) : (
          <ul className="mt-3 divide-y divide-grey-bg text-sm">
            {blocks.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                <span>{formatDateTime(b.startsAt)} – {formatDateTime(b.endsAt)}{b.reason && <em className="text-muted"> · {b.reason}</em>}</span>
                <form action={deleteBlockAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <button className="btn-danger btn-sm" type="submit">Fjern</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addBlockAction} className="mt-5 grid gap-4 sm:grid-cols-2">
          <DateTimeField name="from" label="Fra" />
          <DateTimeField name="to" label="Til" />
          <div>
            <label className="label" htmlFor="reason">Årsag (valgfri)</label>
            <input className="input" id="reason" name="reason" maxLength={200} />
          </div>
          <div className="flex items-end"><button className="btn w-full" type="submit">Bloker</button></div>
        </form>
      </section>
    </div>
  );
}
