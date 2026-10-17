/**
 * SMS-politik (M-5): kun lande på tilladt-listen (standard Danmark) og et loft pr. nummer og pr. døgn mod SMS-pumping.
 * Ren og uden afhængigheder (bruges også af CMS'et i browseren).
 */
export const SMS_COUNTRIES: { code: string; name: string }[] = [
  { code: "45", name: "Danmark" },
  { code: "298", name: "Færøerne" },
  { code: "299", name: "Grønland" },
  { code: "46", name: "Sverige" },
  { code: "47", name: "Norge" },
  { code: "358", name: "Finland" },
  { code: "354", name: "Island" },
  { code: "49", name: "Tyskland" },
  { code: "31", name: "Holland" },
  { code: "32", name: "Belgien" },
  { code: "33", name: "Frankrig" },
  { code: "34", name: "Spanien" },
  { code: "39", name: "Italien" },
  { code: "41", name: "Schweiz" },
  { code: "43", name: "Østrig" },
  { code: "44", name: "Storbritannien" },
  { code: "48", name: "Polen" },
  { code: "351", name: "Portugal" },
  { code: "352", name: "Luxembourg" },
  { code: "353", name: "Irland" },
  { code: "370", name: "Litauen" },
  { code: "371", name: "Letland" },
  { code: "372", name: "Estland" },
];

export const DEFAULT_SMS_COUNTRIES = ["45"];
export const DEFAULT_SMS_PER_NUMBER_CAP = 5;
export const DEFAULT_SMS_DAILY_CAP = 300;

/** Landekoden for et E.164-nummer (længste kendte præfiks), ellers null. */
export function smsCountryCode(e164: string): string | null {
  const digits = /^\+(\d{8,15})$/.exec(e164)?.[1];
  if (!digits) return null;
  const hits = SMS_COUNTRIES.filter((c) => digits.startsWith(c.code)).sort((a, b) => b.code.length - a.code.length);
  return hits[0]?.code ?? null;
}

export function isSmsDestinationAllowed(e164: string, allowed: string[]): boolean {
  const code = smsCountryCode(e164);
  return code !== null && allowed.includes(code);
}

/** "45,46" → ["45","46"]; ukendte koder fjernes; tom liste → Danmark. */
export function parseSmsCountries(value: string | null | undefined): string[] {
  const known = new Set(SMS_COUNTRIES.map((c) => c.code));
  const list = [...new Set((value ?? "").split(/[\s,]+/).filter((c) => known.has(c)))];
  return list.length ? list : [...DEFAULT_SMS_COUNTRIES];
}

export type SmsCapHit = "per_number" | "daily" | null;

/** Er loftet nået? `sentToNumber`/`sentTotal` er antal sendte SMS de seneste 24 timer. */
export function smsCapReached(c: { sentToNumber: number; sentTotal: number; perNumberCap: number; dailyCap: number }): SmsCapHit {
  if (c.sentTotal >= c.dailyCap) return "daily";
  if (c.sentToNumber >= c.perNumberCap) return "per_number";
  return null;
}
