import { registerJobHandler } from "../jobs";
import { cleanupLeads } from "../leads";
import { getNotificationSettings } from "./settings";
import { cleanupNotificationLogs, ensureRecurringJob, processDueNotifications, scanAbandonedOnboarding } from "./service";

const DAY_MS = 86_400_000;

registerJobHandler("cleanup_notification_logs", async () => {
  const n = await cleanupNotificationLogs();
  if (n > 0) console.log(`[notifications] slettede ${n} log-rækker uden for opbevaringsperioden`);
});

registerJobHandler("cleanup_leads", async () => {
  const { leadRetentionMonths } = await getNotificationSettings();
  const n = await cleanupLeads({ retentionMonths: leadRetentionMonths });
  if (n > 0) console.log(`[leads] slettede ${n} leads uden samtykke eller uden for opbevaringsperioden`);
});

/** Kaldes hvert minut af jobprocessoren: finder ufærdige tilmeldinger, sender forfaldne beskeder og planlægger daglig oprydning. */
export async function runNotificationTick(now = new Date()): Promise<{ created: number; sent: number }> {
  const created = await scanAbandonedOnboarding(now);
  const sent = await processDueNotifications({ now });
  await ensureRecurringJob("cleanup_notification_logs", DAY_MS);
  await ensureRecurringJob("cleanup_leads", DAY_MS);
  return { created, sent };
}
