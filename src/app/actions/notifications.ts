"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validateSmsSender } from "@/lib/messaging/sms";
import type { ActionResult } from "@/lib/onboarding/cms-types";
import { DEFAULT_TEMPLATES } from "@/lib/notifications/defaults";
import { loadNotificationLog } from "@/lib/notifications/cms-data";
import type { CmsLogFilter, CmsLogPage, CmsRule, CmsTemplate } from "@/lib/notifications/cms-types";
import { ensureNotificationDefaults, resendLog, sendTestMessage, syncMeetingReminders } from "@/lib/notifications/service";
import { saveNotificationSettings } from "@/lib/notifications/settings";
import { validateTemplate } from "@/lib/notifications/template";
import { validateOffset } from "@/lib/notifications/timing";
import { isTriggerKey, TRIGGERS } from "@/lib/notifications/triggers";

type R<T = object> = Promise<ActionResult<T>>;
const err = (error: string) => ({ ok: false as const, error });
const refresh = () => revalidatePath("/admin/notifikationer");

/** Trigger-variabler for de regler, der bruger skabelonen (tomt = frit valg blandt alle kendte). */
async function allowedFor(templateId: string): Promise<{ trigger: string; label: string; vars: string[] }[]> {
  const rules = await prisma.notificationRule.findMany({ where: { templateId }, select: { trigger: true } });
  return [...new Set(rules.map((r) => r.trigger))].filter(isTriggerKey).map((t) => ({ trigger: t, label: TRIGGERS[t].label, vars: TRIGGERS[t].variables }));
}

function templateProblems(t: { channel: "EMAIL" | "SMS"; name: string; subject: string; body: string }, usage: { label: string; vars: string[] }[]): string | null {
  const base = validateTemplate({ channel: t.channel, name: t.name, subject: t.subject, body: t.body });
  if (base.length) return base[0].message;
  for (const u of usage) {
    const issue = validateTemplate({ channel: t.channel, subject: t.subject, body: t.body }, u.vars)[0];
    if (issue) return `${issue.message} (skabelonen bruges af «${u.label}»)`;
  }
  return null;
}

// ---------------------------------------------------------------- Skabeloner

export async function createTemplateAction(input: { channel: "EMAIL" | "SMS"; name: string }): R<{ template: CmsTemplate }> {
  const admin = await requireRole("ADMIN");
  const p = z.object({ channel: z.enum(["EMAIL", "SMS"]), name: z.string().trim().min(2, "Giv skabelonen et navn.").max(120) }).safeParse(input);
  if (!p.success) return err(p.error.issues[0].message);
  const t = await prisma.notificationTemplate.create({
    data: {
      channel: p.data.channel,
      name: p.data.name,
      subject: p.data.channel === "EMAIL" ? "Emne" : null,
      body: p.data.channel === "EMAIL" ? "Hej {{fornavn}}\n\n\n\nVenlig hilsen\nAdvisory Board Unlimited" : "ABU: ",
      active: false,
    },
  });
  await audit(admin.id, "notification.template.create", "NotificationTemplate", t.id);
  refresh();
  return {
    ok: true,
    template: { id: t.id, key: null, channel: t.channel, name: t.name, subject: t.subject ?? "", body: t.body, active: false, usedBy: 0, locked: false, hasDefault: false },
  };
}

export async function updateTemplateAction(id: string, patch: { name?: string; subject?: string; body?: string; active?: boolean }): R {
  const admin = await requireRole("ADMIN");
  const cur = await prisma.notificationTemplate.findUnique({ where: { id } });
  if (!cur) return err("Skabelonen findes ikke.");
  const next = {
    channel: cur.channel,
    name: patch.name ?? cur.name,
    subject: patch.subject ?? cur.subject ?? "",
    body: patch.body ?? cur.body,
  };
  const usage = await allowedFor(id);
  if (patch.active === false) {
    const lockedUse = usage.find((u) => isTriggerKey(u.trigger) && TRIGGERS[u.trigger].locked);
    if (lockedUse) return err(`Skabelonen bruges af «${lockedUse.label}», som ikke kan slås fra. Redigér teksten i stedet.`);
  }
  if (patch.name !== undefined || patch.subject !== undefined || patch.body !== undefined || patch.active === true) {
    const problem = templateProblems(next, usage);
    if (problem) return err(problem);
  }
  await prisma.notificationTemplate.update({
    where: { id },
    data: {
      name: next.name.trim(),
      subject: cur.channel === "EMAIL" ? next.subject.trim() : null,
      body: next.body.replace(/\r\n/g, "\n"),
      ...(patch.active !== undefined && { active: patch.active }),
    },
  });
  await audit(admin.id, patch.active !== undefined && Object.keys(patch).length === 1 ? (patch.active ? "notification.template.activate" : "notification.template.deactivate") : "notification.template.update", "NotificationTemplate", id);
  refresh();
  return { ok: true };
}

export async function deleteTemplateAction(id: string): R {
  const admin = await requireRole("ADMIN");
  const used = await prisma.notificationRule.count({ where: { templateId: id } });
  if (used > 0) return err(`Skabelonen bruges af ${used} ${used === 1 ? "regel" : "regler"}. Fjern eller skift reglerne først.`);
  await prisma.notificationTemplate.delete({ where: { id } }).catch(() => null);
  await audit(admin.id, "notification.template.delete", "NotificationTemplate", id);
  refresh();
  return { ok: true };
}

export async function restoreTemplateAction(id: string): R<{ subject: string; body: string }> {
  const admin = await requireRole("ADMIN");
  const t = await prisma.notificationTemplate.findUnique({ where: { id } });
  const def = DEFAULT_TEMPLATES.find((d) => d.key === t?.key);
  if (!t || !def) return err("Der findes ingen standardtekst til denne skabelon.");
  await prisma.notificationTemplate.update({ where: { id }, data: { name: def.name, subject: def.subject ?? null, body: def.body } });
  await audit(admin.id, "notification.template.restore", "NotificationTemplate", id);
  refresh();
  return { ok: true, subject: def.subject ?? "", body: def.body };
}

export async function loadDefaultsAction(): R<{ templates: number; rules: number }> {
  const admin = await requireRole("ADMIN");
  const r = await ensureNotificationDefaults();
  await audit(admin.id, "notification.defaults.load", "NotificationTemplate", "all");
  refresh();
  return { ok: true, ...r };
}

export async function sendTestAction(input: { channel: "EMAIL" | "SMS"; subject: string; body: string; to: string; name: string }): R<{ to: string; adapter: string }> {
  const admin = await requireRole("ADMIN");
  const problems = validateTemplate({ channel: input.channel, subject: input.subject, body: input.body });
  if (problems.length) return err(problems[0].message);
  const r = await sendTestMessage({ channel: input.channel, subject: input.subject, body: input.body, to: input.to, userId: admin.id, templateKey: input.name.slice(0, 80) });
  if (!r.ok) return err(r.error);
  await audit(admin.id, "notification.test", "NotificationLog", r.logId);
  const { getEnv } = await import("@/lib/env");
  const env = getEnv();
  refresh();
  return { ok: true, to: input.to, adapter: input.channel === "EMAIL" ? env.EMAIL_PROVIDER : env.SMS_PROVIDER };
}

// ---------------------------------------------------------------- Regler

const ruleSchema = z.object({
  trigger: z.string(),
  offsetMinutes: z.number().int(),
  channel: z.enum(["EMAIL", "SMS"]),
  templateId: z.string().min(1, "Vælg en skabelon."),
  audience: z.enum(["CUSTOMER", "ADVISORS", "BOTH", "SUBJECT"]),
  active: z.boolean(),
  quietHours: z.boolean(),
});

async function checkRule(input: z.infer<typeof ruleSchema>, ignoreId?: string): Promise<string | null> {
  if (!isTriggerKey(input.trigger)) return "Ukendt udløser.";
  const def = TRIGGERS[input.trigger];
  const off = validateOffset(def.timing, input.offsetMinutes);
  if (off) return off;
  if (!def.audiences.includes(input.audience)) return "Modtagergruppen findes ikke for denne udløser.";
  const t = await prisma.notificationTemplate.findUnique({ where: { id: input.templateId } });
  if (!t) return "Skabelonen findes ikke.";
  if (t.channel !== input.channel) return "Skabelonen hører til en anden kanal.";
  const issue = validateTemplate({ channel: t.channel, subject: t.subject, body: t.body }, def.variables)[0];
  if (issue) return `${issue.message} Redigér skabelonen, eller vælg en anden.`;
  const dup = await prisma.notificationRule.findFirst({
    where: { trigger: input.trigger, offsetMinutes: input.offsetMinutes, channel: input.channel, audience: input.audience, templateId: input.templateId, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
  });
  if (dup) return "Der findes allerede en identisk regel.";
  return null;
}

const toCmsRule = (r: { id: string; trigger: string; offsetMinutes: number; channel: "EMAIL" | "SMS"; templateId: string; audience: CmsRule["audience"]; active: boolean; quietHours: boolean }): CmsRule => ({
  id: r.id,
  trigger: r.trigger,
  offsetMinutes: r.offsetMinutes,
  channel: r.channel,
  templateId: r.templateId,
  audience: r.audience,
  active: r.active,
  quietHours: r.quietHours,
});

export async function createRuleAction(input: Omit<CmsRule, "id">): R<{ rule: CmsRule }> {
  const admin = await requireRole("ADMIN");
  const p = ruleSchema.safeParse(input);
  if (!p.success) return err(p.error.issues[0].message);
  const data = { ...p.data, quietHours: p.data.channel === "SMS" && p.data.quietHours };
  const problem = await checkRule(data);
  if (problem) return err(problem);
  const r = await prisma.notificationRule.create({ data });
  await audit(admin.id, "notification.rule.create", "NotificationRule", r.id, `${data.trigger} ${data.offsetMinutes} min`);
  if (data.trigger === "meeting_reminder") await replanReminders();
  refresh();
  return { ok: true, rule: toCmsRule(r) };
}

export async function updateRuleAction(id: string, input: Partial<Omit<CmsRule, "id">>): R<{ rule: CmsRule }> {
  const admin = await requireRole("ADMIN");
  const cur = await prisma.notificationRule.findUnique({ where: { id } });
  if (!cur) return err("Reglen findes ikke.");
  const merged = { ...toCmsRule(cur), ...input };
  const p = ruleSchema.safeParse(merged);
  if (!p.success) return err(p.error.issues[0].message);
  const data = { ...p.data, quietHours: p.data.channel === "SMS" && p.data.quietHours };
  const def = isTriggerKey(cur.trigger) ? TRIGGERS[cur.trigger] : null;
  if (def?.locked && !data.active) return err(`«${def.label}» er transaktionel og kan ikke slås fra. Du kan redigere teksten.`);
  if (data.trigger !== cur.trigger) return err("Udløseren kan ikke ændres. Opret en ny regel.");
  const problem = await checkRule(data, id);
  if (problem) return err(problem);
  const r = await prisma.notificationRule.update({ where: { id }, data });
  await audit(admin.id, Object.keys(input).length === 1 && "active" in input ? (data.active ? "notification.rule.activate" : "notification.rule.deactivate") : "notification.rule.update", "NotificationRule", id);
  if (cur.trigger === "meeting_reminder") await replanReminders();
  refresh();
  return { ok: true, rule: toCmsRule(r) };
}

export async function deleteRuleAction(id: string): R {
  const admin = await requireRole("ADMIN");
  const cur = await prisma.notificationRule.findUnique({ where: { id } });
  if (!cur) return { ok: true };
  const def = isTriggerKey(cur.trigger) ? TRIGGERS[cur.trigger] : null;
  if (def?.locked) {
    const others = await prisma.notificationRule.count({ where: { trigger: cur.trigger, id: { not: id } } });
    if (others === 0) return err(`«${def.label}» er transaktionel og skal have mindst én regel.`);
  }
  // Ventende beskeder fra reglen annulleres
  await prisma.notificationLog.updateMany({ where: { ruleId: id, status: "QUEUED" }, data: { status: "SKIPPED", error: "Reglen er slettet" } });
  await prisma.notificationRule.delete({ where: { id } });
  await audit(admin.id, "notification.rule.delete", "NotificationRule", id, `${cur.trigger} ${cur.offsetMinutes} min`);
  refresh();
  return { ok: true };
}

/** Efter ændring af påmindelsesregler: planlæg kommende møders påmindelser igen. */
async function replanReminders() {
  const meetings = await prisma.meeting.findMany({ where: { status: "BOOKED", startsAt: { gt: new Date() } }, select: { id: true } });
  for (const m of meetings) await syncMeetingReminders(m.id).catch((e) => console.error("[notifications] genplanlægning fejlede", e));
}

// ---------------------------------------------------------------- Log

export async function listLogsAction(filter: CmsLogFilter, cursor?: string | null): R<{ page: CmsLogPage }> {
  await requireRole("ADMIN");
  return { ok: true, page: await loadNotificationLog(filter, cursor) };
}

export async function resendLogAction(id: string): R {
  const admin = await requireRole("ADMIN");
  const r = await resendLog(id);
  if (!r.ok) return err(r.error);
  await audit(admin.id, "notification.resend", "NotificationLog", id);
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------- Indstillinger

export async function saveSettingsAction(input: {
  quietEnabled: boolean;
  quietStart: number;
  quietEnd: number;
  smsSender: string;
  logRetentionMonths: number;
  leadRetentionMonths: number;
}): R {
  const admin = await requireRole("ADMIN");
  const p = z
    .object({
      quietEnabled: z.boolean(),
      quietStart: z.number().int().min(0).max(23),
      quietEnd: z.number().int().min(0).max(23),
      smsSender: z.string().trim(),
      logRetentionMonths: z.number().int().min(1, "Log skal gemmes mindst 1 måned.").max(60, "Højst 60 måneder."),
      leadRetentionMonths: z.number().int().min(1, "Leads skal gemmes mindst 1 måned.").max(60, "Højst 60 måneder."),
    })
    .safeParse(input);
  if (!p.success) return err(p.error.issues[0].message);
  const s = p.data;
  if (s.quietEnabled && s.quietStart === s.quietEnd) return err("Start og slut på de stille timer må ikke være ens.");
  const senderProblem = validateSmsSender(s.smsSender);
  if (senderProblem) return err(senderProblem);
  await saveNotificationSettings({
    quietHours: s.quietEnabled ? { startHour: s.quietStart, endHour: s.quietEnd } : null,
    smsSender: s.smsSender,
    logRetentionMonths: s.logRetentionMonths,
    leadRetentionMonths: s.leadRetentionMonths,
  });
  await audit(admin.id, "notification.settings.update", "AppSetting", "notif");
  refresh();
  return { ok: true };
}
