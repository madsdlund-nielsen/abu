import { prisma } from "../db";
import { getEnv } from "../env";
import { DEFAULT_TEMPLATES } from "./defaults";
import type { CmsLogFilter, CmsLogPage, CmsLogRow, CmsProviders, CmsRule, CmsSettings, CmsTemplate } from "./cms-types";
import { ensureNotificationDefaults } from "./service";
import { getNotificationSettings } from "./settings";
import { isTriggerKey, TRIGGERS } from "./triggers";

const DEFAULT_KEYS = new Set(DEFAULT_TEMPLATES.map((t) => t.key));

export async function loadNotificationsCms(): Promise<{ templates: CmsTemplate[]; rules: CmsRule[]; settings: CmsSettings; providers: CmsProviders }> {
  // Første besøg: indlæs standardtekster og -regler
  if ((await prisma.notificationTemplate.count()) === 0) await ensureNotificationDefaults();
  const [templates, rules, settings] = await Promise.all([
    prisma.notificationTemplate.findMany({ orderBy: [{ channel: "asc" }, { name: "asc" }] }),
    prisma.notificationRule.findMany({ orderBy: [{ trigger: "asc" }, { offsetMinutes: "asc" }, { createdAt: "asc" }] }),
    getNotificationSettings(),
  ]);
  const env = getEnv();
  const usedBy = new Map<string, number>();
  const lockedBy = new Set<string>();
  for (const r of rules) {
    usedBy.set(r.templateId, (usedBy.get(r.templateId) ?? 0) + 1);
    if (isTriggerKey(r.trigger) && TRIGGERS[r.trigger].locked) lockedBy.add(r.templateId);
  }
  return {
    templates: templates.map((t) => ({
      id: t.id,
      key: t.key,
      channel: t.channel,
      name: t.name,
      subject: t.subject ?? "",
      body: t.body,
      active: t.active,
      usedBy: usedBy.get(t.id) ?? 0,
      locked: lockedBy.has(t.id),
      hasDefault: t.key !== null && DEFAULT_KEYS.has(t.key),
    })),
    rules: rules.map((r) => ({
      id: r.id,
      trigger: r.trigger,
      offsetMinutes: r.offsetMinutes,
      channel: r.channel,
      templateId: r.templateId,
      audience: r.audience,
      active: r.active,
      quietHours: r.quietHours,
    })),
    settings: {
      quietEnabled: settings.quietHours !== null,
      quietStart: settings.quietHours?.startHour ?? 21,
      quietEnd: settings.quietHours?.endHour ?? 8,
      smsSender: settings.smsSender,
      logRetentionMonths: settings.logRetentionMonths,
      leadRetentionMonths: settings.leadRetentionMonths,
    },
    providers: { email: env.EMAIL_PROVIDER, sms: env.SMS_PROVIDER, inmobileKey: Boolean(env.INMOBILE_API_KEY), appUrl: env.APP_URL },
  };
}

const PAGE = 40;

export async function loadNotificationLog(filter: CmsLogFilter, cursor?: string | null): Promise<CmsLogPage> {
  const q = filter.q?.trim();
  const rows = await prisma.notificationLog.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.channel ? { channel: filter.channel } : {}),
      ...(filter.trigger ? { trigger: filter.trigger } : {}),
      ...(q ? { OR: [{ recipientAddress: { contains: q, mode: "insensitive" as const } }, { templateKey: { contains: q, mode: "insensitive" as const } }] } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, PAGE);
  const mapped: CmsLogRow[] = page.map((l) => ({
    id: l.id,
    createdAt: l.createdAt.toISOString(),
    scheduledFor: l.scheduledFor.toISOString(),
    sentAt: l.sentAt?.toISOString() ?? null,
    status: l.status,
    channel: l.channel,
    trigger: l.trigger,
    triggerLabel: isTriggerKey(l.trigger) ? TRIGGERS[l.trigger].label : l.trigger === "test" ? "Test fra CMS" : l.trigger,
    templateKey: l.templateKey,
    recipient: l.recipientAddress,
    subject: l.subject,
    preview: l.preview,
    error: l.error,
    canResend: l.status === "FAILED" && l.entityType !== "test" && !(isTriggerKey(l.trigger) && TRIGGERS[l.trigger].sensitive),
  }));
  return { rows: mapped, nextCursor: rows.length > PAGE ? page[page.length - 1].id : null };
}
