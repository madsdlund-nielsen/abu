import type { Metadata } from "next";
import { deleteBlockAction, deleteRuleAction } from "@/app/actions/advisor";
import { AddBlockForm, AddRuleForm } from "@/components/advisor-forms";
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
        <AddRuleForm />
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
        <AddBlockForm />
      </section>
    </div>
  );
}
