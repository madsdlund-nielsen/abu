import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { bookAction } from "@/app/actions/meetings";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { Empty } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { getBookableSlots, getQuotaInfo } from "@/lib/booking";
import { getEnv } from "@/lib/env";
import { bookingWindow } from "@/lib/slots";
import { getCustomerSubscription } from "@/lib/subscriptions";
import { addDaysKey, formatDateTime, formatTime, localDateKey } from "@/lib/time";
import {
  buildWeek,
  clampWeek,
  DAY_SHORT,
  firstWeekWithSlots,
  isValidDateKey,
  mondayKey,
  shortDate,
  weekLabel,
  weekPeriods,
} from "@/lib/week-view";

export const metadata: Metadata = { title: "Book møde" };

export default async function BookPage({ searchParams }: { searchParams: SP }) {
  const user = await requireRole("CUSTOMER");
  const { ok, err, one, params } = await flashFrom(searchParams);
  const sub = await getCustomerSubscription(user.id);

  if (!sub || sub.status !== "ACTIVE" || !sub.startedAt) {
    return (
      <div>
        <h1>Book møde</h1>
        <div className="mt-6">
          <Empty>
            Du skal have et aktivt abonnement for at booke møder. <Link href="/subscribe">Vælg abonnement</Link>
          </Empty>
        </div>
      </div>
    );
  }

  const now = new Date();
  const slots = await getBookableSlots(sub.id, now);
  const quota = await getQuotaInfo(sub.id, now);
  const duration = getEnv().MEETING_DURATION_MINUTES;

  // Ugenavigation: fra ugen med "nu" til ugen med bookingvinduets slutning. Start i første uge med ledige tider.
  const minMonday = mondayKey(localDateKey(now));
  const maxMonday = mondayKey(localDateKey(bookingWindow({ now }).latest));
  const first = firstWeekWithSlots(slots);
  const requested = one(params.uge);
  const monday = clampWeek(isValidDateKey(requested) ? mondayKey(requested) : (first ?? minMonday), minMonday, maxMonday);
  const week = buildWeek(slots, monday);
  const prevMonday = addDaysKey(monday, -7);
  const nextMonday = addDaysKey(monday, 7);
  const hasPrev = monday > minMonday;
  const hasNext = monday < maxMonday;
  const weeksWithSlots = new Set(slots.map((s) => mondayKey(localDateKey(s))));
  const nextWithSlots = [...weeksWithSlots].filter((k) => k > monday).sort()[0];
  const noQuota = quota && quota.openPeriods.length === 0;
  // Inaktive rådgivere kan ikke bookes (QA #13)
  const inactive = sub.advisors.filter((a) => !a.advisor.active).map((a) => a.advisor.user.name);
  const periods = quota
    ? weekPeriods(monday, sub.startedAt, sub.frequencyWeeks, quota.currentPeriod, quota.openPeriods)
    : [];
  const href = (m: string) => `/book?uge=${m}`;
  // Én idempotens-nøgle pr. visning af siden (QA #1): dobbeltklik booker ikke to gange og giver ikke en fejl
  const idem = randomUUID();

  return (
    <div>
      <h1>Book møde</h1>
      <p className="mb-6 mt-4 max-w-3xl text-muted">
        Mødet varer {duration / 60 >= 1 ? `${duration / 60} timer` : `${duration} minutter`} og afholdes online. Tidspunkterne herunder er
        tidspunkter, hvor alle dine rådgivere ({sub.advisors.map((a) => a.advisor.user.name).join(", ")}) er ledige.
      </p>
      <Flash ok={ok} err={err} />
      {inactive.length > 0 ? (
        <Empty>
          {inactive.join(" og ")} er ikke aktiv lige nu, så der kan ikke bookes møder med dit board. Vælg en anden rådgiver under{" "}
          <Link href="/account/subscription">Konto → Abonnement</Link>, eller kontakt os.
        </Empty>
      ) : noQuota ? (
        <Empty>Du har brugt møderne for den aktuelle og næste periode. Du kan booke igen, når en ny periode åbner.</Empty>
      ) : slots.length === 0 ? (
        <Empty>Der er desværre ingen ledige tidspunkter, hvor alle rådgivere kan. Prøv igen senere, eller kontakt os.</Empty>
      ) : (
        <section aria-labelledby="week-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3 sm:px-6">
            {hasPrev ? (
              <Link href={href(prevMonday)} className="btn-secondary btn-sm" rel="prev">Forrige uge</Link>
            ) : (
              <span className="btn-secondary btn-sm pointer-events-none opacity-40" aria-disabled="true">Forrige uge</span>
            )}
            <h2 id="week-heading" className="text-center" aria-live="polite">{weekLabel(monday)}</h2>
            {hasNext ? (
              <Link href={href(nextMonday)} className="btn-secondary btn-sm" rel="next">Næste uge</Link>
            ) : (
              <span className="btn-secondary btn-sm pointer-events-none opacity-40" aria-disabled="true">Næste uge</span>
            )}
          </div>

          <ul className="mt-space-3 space-y-1 text-sm text-muted" data-testid="week-periods">
            {periods.map((p) => (
              <li key={p.index}>
                <strong className="text-navy">Periode {p.index + 1}</strong> ({shortDate(p.startKey)}–{shortDate(p.endKey)}
                {p.kind === "current" ? ", din nuværende periode" : p.kind === "next" ? ", næste periode" : ""}):{" "}
                {p.open
                  ? `du har et møde til gode (hver ${sub.frequencyWeeks}. uge).`
                  : "mødet for perioden er allerede booket, så der kan ikke bookes her."}
              </li>
            ))}
          </ul>

          <div
            className={`mt-space-4 grid gap-px bg-grey-bg sm:grid-cols-2 ${week.days.length === 7 ? "lg:grid-cols-7" : "lg:grid-cols-5"}`}
            data-testid="week-grid"
          >
            {week.days.map((d) => (
              <div key={d.key} className="bg-white p-4">
                <h3 className="!text-navy">
                  {DAY_SHORT[d.index]} <span className="font-normal normal-case">{shortDate(d.key)}</span>
                </h3>
                {d.slots.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">Ingen ledige tider</p>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {d.slots.map((s) => (
                      <form key={s.toISOString()} action={bookAction}>
                        <input type="hidden" name="startsAt" value={s.toISOString()} />
                        <input type="hidden" name="idem" value={idem} />
                        <button className="btn-secondary btn-sm w-full" type="submit" aria-label={`Book ${formatDateTime(s)}`}>
                          {formatTime(s)}
                        </button>
                      </form>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {week.total === 0 && (
            <p className="mt-space-4 text-muted">
              Der er ingen ledige tider i denne uge.{" "}
              {nextWithSlots && <Link href={href(nextWithSlots)}>Gå til næste uge med ledige tider</Link>}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
