"use client";

import { useId, useState } from "react";

const TIME_OPTIONS: string[] = [];
for (let m = 0; m < 1440; m += 15) {
  TIME_OPTIONS.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
}

/** Regex for dd.mm.åååå (tillader 1-cifrede dag/måned). Samme regler som parseDanishDate på serveren. */
export const DK_DATE_PATTERN = "\\d{1,2}[./-]\\d{1,2}[./-]\\d{4}";

function isValidDanishDate(v: string): boolean {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(v.trim());
  if (!m) return false;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || y < 1900) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Indsætter punktummer, mens der skrives: 19102026 -> 19.10.2026 */
function autoDots(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

/**
 * 24-timers tidsvælger i 15 minutters trin (select, så ingen AM/PM uanset browsersprog).
 * Sender "HH:mm" under `name`.
 */
export function TimeSelect({
  id,
  name,
  defaultValue = "09:00",
  label,
  allowEndOfDay = false,
  required = true,
}: {
  id?: string;
  name: string;
  defaultValue?: string;
  label?: string;
  allowEndOfDay?: boolean;
  required?: boolean;
}) {
  const options = [...TIME_OPTIONS];
  if (allowEndOfDay) options.push("24:00");
  if (!options.includes(defaultValue)) {
    options.push(defaultValue);
    options.sort();
  }
  return (
    <select id={id} name={name} defaultValue={defaultValue} required={required} aria-label={label} className="input">
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

/**
 * Dansk dato + tid: tekstfelt "dd.mm.åååå" og 24-timers tidsvælger.
 * Sender to felter: `${name}Date` ("dd.mm.åååå") og `${name}Time` ("HH:mm"), tolket som Europe/Copenhagen på serveren.
 */
export function DateTimeField({
  name,
  label,
  defaultDate = "",
  defaultTime = "09:00",
  required = true,
}: {
  name: string;
  label: string;
  defaultDate?: string;
  defaultTime?: string;
  required?: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState(defaultDate);
  const [touched, setTouched] = useState(false);
  const invalid = touched && value !== "" && !isValidDanishDate(value);
  const errId = `${id}-err`;

  return (
    <fieldset className="min-w-0">
      <legend className="label">{label}</legend>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <input
            id={`${id}-date`}
            name={`${name}Date`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="dd.mm.åååå"
            maxLength={10}
            pattern={DK_DATE_PATTERN}
            required={required}
            value={value}
            aria-label={`${label}, dato (dd.mm.åååå)`}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errId : undefined}
            className="input"
            onChange={(e) => {
              const next = autoDots(e.target.value);
              setValue(next);
              e.target.setCustomValidity(next === "" || isValidDanishDate(next) ? "" : "Skriv datoen som dd.mm.åååå, fx 19.10.2026");
            }}
            onBlur={() => setTouched(true)}
          />
        </div>
        <div className="w-28 shrink-0">
          <TimeSelect name={`${name}Time`} defaultValue={defaultTime} label={`${label}, klokkeslæt (24 timer)`} />
        </div>
      </div>
      {invalid && (
        <p id={errId} role="alert" className="mt-1 text-xs text-danger">
          Ugyldig dato. Skriv dd.mm.åååå, fx 19.10.2026.
        </p>
      )}
    </fieldset>
  );
}
