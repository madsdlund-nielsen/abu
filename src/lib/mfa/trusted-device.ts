/**
 * Betroede enheder («Husk denne enhed i 30 dage») – rene funktioner. DB-delen ligger i `service.ts`.
 *
 *  - Udløb er fast fra oprettelsen (createdAt + N dage) og forlænges ALDRIG ved brug: koden kræves igen højst hver N. dag.
 *  - N sættes i Admin → Administratorer (AppSetting `mfa.trustedDeviceDays`, standard og højst 30, 0 = slået fra).
 *    Sænkes N, gælder det straks også for eksisterende enheder (gyldig til min(expiresAt, createdAt + N dage)).
 */
export const DEVICE_COOKIE = "abu_device";
export const TRUSTED_DEVICE_DAYS_DEFAULT = 30;
export const TRUSTED_DEVICE_DAYS_MAX = 30;
export const TRUSTED_DEVICE_SETTING = "mfa.trustedDeviceDays";
const DAY = 86_400_000;

export function clampTrustedDays(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return TRUSTED_DEVICE_DAYS_DEFAULT;
  return Math.min(TRUSTED_DEVICE_DAYS_MAX, Math.max(0, Math.trunc(n)));
}

export function trustedDeviceExpiry(createdAt: Date, days: number): Date {
  return new Date(createdAt.getTime() + clampTrustedDays(days) * DAY);
}

export interface DeviceTimes {
  createdAt: Date;
  expiresAt: Date;
}

/** Gyldig nu? Udløbet er det tidligste af det gemte udløb og den nuværende indstilling regnet fra oprettelsen. */
export function isTrustedDeviceValid(d: DeviceTimes, now: Date, days: number): boolean {
  if (clampTrustedDays(days) === 0) return false;
  const limit = Math.min(d.expiresAt.getTime(), trustedDeviceExpiry(d.createdAt, days).getTime());
  return now.getTime() < limit;
}

/** Hvornår ophører enheden (til visning)? */
export function trustedDeviceEndsAt(d: DeviceTimes, days: number): Date {
  return new Date(Math.min(d.expiresAt.getTime(), trustedDeviceExpiry(d.createdAt, days).getTime()));
}

/** Grov beskrivelse af browser og styresystem, fx «Chrome på macOS». Ingen versionsnumre (dataminimering). */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Ukendt browser";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "ukendt system";
  return `${browser} på ${os}`;
}

/** Omtrentlig IP: IPv4 /24 («203.0.113.0/24»), IPv6 /48. Ukendt → null. */
export function ipPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, "");
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
  if (m) return `${m[1]}.${m[2]}.${m[3]}.0/24`;
  if (ip.includes(":")) {
    const [head] = ip.split("::");
    const groups = head.split(":").filter(Boolean).slice(0, 3);
    while (groups.length < 3) groups.push("0");
    return `${groups.join(":")}::/48`;
  }
  return null;
}
