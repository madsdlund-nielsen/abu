import type { Metadata } from "next";
import { setHolidayBlockedAction } from "@/app/actions/admin";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { danishHolidays, getHolidayOverrides, isHolidayBlocked } from "@/lib/holidays";
import { formatDate, localDateKey, TZ } from "@/lib/time";

export const metadata: Metadata = { title: "Helligdage" };

const weekday = (key: string) => new Intl.DateTimeFormat("da-DK", { weekday: "long", timeZone: TZ }).format(new Date(`${key}T12:00:00Z`));

/** Helligdage og lukkedage, der spærrer for booking (plan #24). Beregnes automatisk; admin kan slå enkelte datoer til/fra. */
export default async function HolidaysPage({ searchParams }: { searchParams: SP }) {
  const { ok, err } = await flashFrom(searchParams);
  const today = localDateKey(new Date());
  const year = Number(today.slice(0, 4));
  const overrides = await getHolidayOverrides();
  const years = [year, year + 1];
  return (
    <div className="space-y-6">
      <div>
        <span className="eyebrow">Admin · Booking</span>
        <h1>Helligdage og lukkedage</h1>
        <p className="mt-space-3 max-w-3xl text-muted">
          Spærrede dage kan ikke bookes af kunder. Helligdagene beregnes automatisk (også de påskeafhængige). Store bededag er afskaffet fra 2024.
          Juleaftensdag og nytårsaftensdag er spærret som standard; grundlovsdag kan slås til.
        </p>
      </div>
      <Flash ok={ok} err={err} />
      {years.map((y) => (
        <section key={y} className="card" aria-labelledby={`y-${y}`}>
          <h2 id={`y-${y}`}>{y}</h2>
          <div className="table-wrap mt-3">
            <table className="table">
              <thead>
                <tr><th>Dato</th><th>Dag</th><th>Type</th><th>Booking</th><th /></tr>
              </thead>
              <tbody>
                {danishHolidays(y).map((h) => {
                  const blocked = isHolidayBlocked(h, overrides);
                  const past = h.date < today;
                  return (
                    <tr key={h.date} className={past ? "opacity-60" : ""} data-holiday={h.key}>
                      <td className="whitespace-nowrap tabular-nums">{formatDate(new Date(`${h.date}T12:00:00Z`))}</td>
                      <td>
                        <span className="font-semibold text-navy">{h.name}</span>
                        <span className="block text-xs capitalize text-muted">{weekday(h.date)}</span>
                      </td>
                      <td className="text-sm">{h.optional ? "Lukkedag (valgfri)" : "Helligdag"}</td>
                      <td>
                        <span className={`badge ${blocked ? "badge-navy" : "badge-muted"}`}>{blocked ? "Spærret" : "Åben"}</span>
                        {h.date in overrides && <span className="ml-1 text-xs text-muted">(ændret)</span>}
                      </td>
                      <td className="text-right">
                        {!past && (
                          <form action={setHolidayBlockedAction}>
                            <input type="hidden" name="date" value={h.date} />
                            <input type="hidden" name="blocked" value={blocked ? "0" : "1"} />
                            <button className="btn-secondary btn-sm" type="submit">{blocked ? "Åbn for booking" : "Spær"}</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
