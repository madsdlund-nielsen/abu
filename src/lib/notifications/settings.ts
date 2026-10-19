import { prisma } from "../db";
import { getEnv } from "../env";
import { DEFAULT_SMS_DAILY_CAP, DEFAULT_SMS_PER_NUMBER_CAP, parseSmsCountries } from "./sms-policy";
import { formatQuietHours, parseQuietHours, type QuietHours } from "./timing";

const KEYS = {
  quiet: "notif.quietHours",
  sender: "notif.smsSender",
  retention: "notif.logRetentionMonths",
  leads: "notif.leadRetentionMonths",
  smsCountries: "notif.smsCountries",
  smsPerNumberCap: "notif.smsPerNumberCap",
  smsDailyCap: "notif.smsDailyCap",
} as const;

export interface NotificationSettings {
  /** null = ingen stille timer */
  quietHours: QuietHours | null;
  smsSender: string;
  logRetentionMonths: number;
  leadRetentionMonths: number;
  /** Landekoder, der må modtage SMS (M-5). Standard: ["45"]. */
  smsCountries: string[];
  /** Højst så mange SMS til samme nummer pr. 24 timer */
  smsPerNumberCap: number;
  /** Højst så mange SMS i alt pr. 24 timer */
  smsDailyCap: number;
}

/** CMS-indstillinger med miljøvariablerne som standardværdier. */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  const env = getEnv();
  const rows = await prisma.appSetting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const retention = Number(map.get(KEYS.retention));
  const leads = Number(map.get(KEYS.leads));
  const perNumber = Number(map.get(KEYS.smsPerNumberCap));
  const daily = Number(map.get(KEYS.smsDailyCap));
  return {
    quietHours: parseQuietHours(map.has(KEYS.quiet) ? map.get(KEYS.quiet) : env.SMS_QUIET_HOURS),
    smsSender: map.get(KEYS.sender) || env.SMS_SENDER,
    logRetentionMonths: Number.isInteger(retention) && retention >= 1 ? retention : env.NOTIFICATION_LOG_RETENTION_MONTHS,
    leadRetentionMonths: Number.isInteger(leads) && leads >= 1 ? leads : env.LEAD_RETENTION_MONTHS,
    smsCountries: parseSmsCountries(map.get(KEYS.smsCountries)),
    smsPerNumberCap: Number.isInteger(perNumber) && perNumber >= 1 ? perNumber : DEFAULT_SMS_PER_NUMBER_CAP,
    smsDailyCap: Number.isInteger(daily) && daily >= 1 ? daily : DEFAULT_SMS_DAILY_CAP,
  };
}

export async function saveNotificationSettings(s: NotificationSettings): Promise<void> {
  const entries: [string, string][] = [
    [KEYS.quiet, formatQuietHours(s.quietHours)],
    [KEYS.sender, s.smsSender],
    [KEYS.retention, String(s.logRetentionMonths)],
    [KEYS.leads, String(s.leadRetentionMonths)],
    [KEYS.smsCountries, s.smsCountries.join(",")],
    [KEYS.smsPerNumberCap, String(s.smsPerNumberCap)],
    [KEYS.smsDailyCap, String(s.smsDailyCap)],
  ];
  // Interaktiv transaktion (RLS: array-transaktioner understøttes ikke af databasekonteksten)
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of entries) await tx.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  });
}
