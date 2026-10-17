import { prisma } from "../db";
import { getEnv } from "../env";
import { formatQuietHours, parseQuietHours, type QuietHours } from "./timing";

const KEYS = { quiet: "notif.quietHours", sender: "notif.smsSender", retention: "notif.logRetentionMonths", leads: "notif.leadRetentionMonths" } as const;

export interface NotificationSettings {
  /** null = ingen stille timer */
  quietHours: QuietHours | null;
  smsSender: string;
  logRetentionMonths: number;
  leadRetentionMonths: number;
}

/** CMS-indstillinger med miljøvariablerne som standardværdier. */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  const env = getEnv();
  const rows = await prisma.appSetting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const retention = Number(map.get(KEYS.retention));
  const leads = Number(map.get(KEYS.leads));
  return {
    quietHours: parseQuietHours(map.has(KEYS.quiet) ? map.get(KEYS.quiet) : env.SMS_QUIET_HOURS),
    smsSender: map.get(KEYS.sender) || env.SMS_SENDER,
    logRetentionMonths: Number.isInteger(retention) && retention >= 1 ? retention : env.NOTIFICATION_LOG_RETENTION_MONTHS,
    leadRetentionMonths: Number.isInteger(leads) && leads >= 1 ? leads : env.LEAD_RETENTION_MONTHS,
  };
}

export async function saveNotificationSettings(s: NotificationSettings): Promise<void> {
  const entries: [string, string][] = [
    [KEYS.quiet, formatQuietHours(s.quietHours)],
    [KEYS.sender, s.smsSender],
    [KEYS.retention, String(s.logRetentionMonths)],
    [KEYS.leads, String(s.leadRetentionMonths)],
  ];
  await prisma.$transaction(
    entries.map(([key, value]) => prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })),
  );
}
