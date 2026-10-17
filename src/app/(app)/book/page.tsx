import type { Metadata } from "next";
import Link from "next/link";
import { bookAction } from "@/app/actions/meetings";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { Empty } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { getBookableSlots, getQuotaInfo } from "@/lib/booking";
import { getEnv } from "@/lib/env";
import { getCustomerSubscription } from "@/lib/subscriptions";
import { formatDate, formatTime, localDateKey } from "@/lib/time";
import { formatInTimeZone } from "date-fns-tz";
import { da } from "date-fns/locale";

export const metadata: Metadata = { title: "Book møde" };

export default async function BookPage({ searchParams }: { searchParams: SP }) {
  const user = await requireRole("CUSTOMER");
  const { ok, err } = await flashFrom(searchParams);
  const sub = await getCustomerSubscription(user.id);

  if (!sub || sub.status !== "ACTIVE") {
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

  const slots = await getBookableSlots(sub.id);
  const quota = await getQuotaInfo(sub.id);
  const byDay = new Map<string, Date[]>();
  for (const s of slots) {
    const k = localDateKey(s);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const duration = getEnv().MEETING_DURATION_MINUTES;

  return (
    <div>
      <h1>Book møde</h1>
      <p className="mb-6 mt-2 text-slate-600">
        Mødet varer {duration / 60 >= 1 ? `${duration / 60} timer` : `${duration} minutter`} og afholdes online. Tidspunkterne herunder er
        tidspunkter, hvor alle dine rådgivere ({sub.advisors.map((a) => a.advisor.user.name).join(", ")}) er ledige.
      </p>
      <Flash ok={ok} err={err} />
      {quota && quota.openPeriods.length === 0 ? (
        <Empty>Du har brugt møderne for den aktuelle og næste periode. Du kan booke igen, når en ny periode åbner.</Empty>
      ) : byDay.size === 0 ? (
        <Empty>Der er desværre ingen ledige tidspunkter, hvor alle rådgivere kan. Prøv igen senere, eller kontakt os.</Empty>
      ) : (
        <div className="space-y-3">
          {[...byDay.entries()].map(([day, list], i) => (
            <details key={day} className="card !p-0" open={i === 0}>
              <summary className="cursor-pointer px-5 py-3 font-medium first-letter:uppercase">
                {formatInTimeZone(list[0], "Europe/Copenhagen", "EEEE d. MMMM yyyy", { locale: da })}
                <span className="ml-2 text-xs font-normal normal-case text-slate-500">{list.length} tider</span>
              </summary>
              <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-4">
                {list.map((s) => (
                  <form key={s.toISOString()} action={bookAction}>
                    <input type="hidden" name="startsAt" value={s.toISOString()} />
                    <button className="btn-secondary btn-sm" type="submit" title={formatDate(s)}>
                      {formatTime(s)}
                    </button>
                  </form>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
