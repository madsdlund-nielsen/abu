import { randomUUID } from "node:crypto";
import type { NotificationAudience, NotificationChannel, Prisma, User } from "@prisma/client";
import { prisma } from "../db";
import { getEnv } from "../env";
import { getEmail } from "../messaging/email";
import { getSms } from "../messaging/sms";
import { hasMarketingConsent, withdrawMarketing } from "../leads";
import { toE164 } from "../phone";
import { DEFAULT_RULES, DEFAULT_TEMPLATES } from "./defaults";
import { buildEmail } from "./email-layout";
import { planMeetingReminders, planNotifications, reminderDedupe, type ExistingEntry, type PlanRecipient } from "./plan";
import { getNotificationSettings } from "./settings";
import { renderTemplate } from "./template";
import { adjustForQuietHours } from "./timing";
import { isTriggerKey, TRIGGERS, VARIABLES, type TriggerDef, type TriggerKey } from "./triggers";
import { unsubscribeUrl } from "./unsubscribe";
import { describeChange, firstName, joinNames, meetingDateVars, type ChangeRole } from "./variables";

const appUrl = () => getEnv().APP_URL.replace(/\/$/, "");

// --------------------------------------------------------------------------- Standardtekster

/** Opretter manglende standardskabeloner, og standardregler for udløsere uden nogen regler. Overskriver aldrig redigeret indhold. */
export async function ensureNotificationDefaults(opts: { onlyTrigger?: TriggerKey } = {}): Promise<{ templates: number; rules: number }> {
  let templates = 0;
  let rules = 0;
  const idByKey = new Map<string, string>();
  for (const t of DEFAULT_TEMPLATES) {
    const existing = await prisma.notificationTemplate.findUnique({ where: { key: t.key } });
    if (existing) {
      idByKey.set(t.key, existing.id);
      continue;
    }
    const row = await prisma.notificationTemplate.create({
      data: { key: t.key, channel: t.channel, name: t.name, subject: t.subject ?? null, body: t.body },
    });
    idByKey.set(t.key, row.id);
    templates++;
  }
  const have = new Set((await prisma.notificationRule.findMany({ select: { trigger: true }, distinct: ["trigger"] })).map((r) => r.trigger));
  for (const r of DEFAULT_RULES) {
    if (opts.onlyTrigger && r.trigger !== opts.onlyTrigger) continue;
    if (have.has(r.trigger)) continue;
    await prisma.notificationRule.create({
      data: {
        trigger: r.trigger,
        offsetMinutes: r.offsetMinutes,
        channel: r.channel,
        templateId: idByKey.get(r.templateKey)!,
        audience: r.audience,
        quietHours: r.quietHours ?? false,
      },
    });
    rules++;
  }
  return { templates, rules };
}

// --------------------------------------------------------------------------- Modtagere

export interface Recipient extends PlanRecipient {
  name: string;
  kind: "customer" | "advisor" | "subject";
}

function userRecipient(u: Pick<User, "id" | "name" | "email" | "phone">, kind: Recipient["kind"]): Recipient {
  const audiences: NotificationAudience[] = kind === "customer" ? ["CUSTOMER", "BOTH"] : kind === "advisor" ? ["ADVISORS", "BOTH"] : ["SUBJECT"];
  return { userId: u.id, name: u.name, email: u.email, phone: u.phone, audiences, kind };
}

async function activeRules(trigger: TriggerKey) {
  let rules = await prisma.notificationRule.findMany({ where: { trigger, active: true }, include: { template: true } });
  const def = TRIGGERS[trigger];
  if (def.locked && rules.length === 0 && (await prisma.notificationRule.count({ where: { trigger } })) === 0) {
    await ensureNotificationDefaults({ onlyTrigger: trigger });
    rules = await prisma.notificationRule.findMany({ where: { trigger, active: true }, include: { template: true } });
  }
  return rules.filter((r) => r.template.active || def.locked);
}

type LogCreate = Prisma.NotificationLogCreateManyInput;

async function insertLogs(
  entries: ReturnType<typeof planNotifications>["create"],
  base: { trigger: TriggerKey; entityType: string; entityId: string; context?: Prisma.InputJsonValue; templateKeyByRule: Map<string, string> },
): Promise<string[]> {
  if (entries.length === 0) return [];
  const data: LogCreate[] = entries.map((e) => ({
    id: randomUUID(),
    ruleId: e.ruleId,
    templateKey: base.templateKeyByRule.get(e.ruleId) ?? "",
    trigger: base.trigger,
    channel: e.channel,
    recipientUserId: e.recipientUserId,
    recipientAddress: e.recipientAddress,
    entityType: base.entityType,
    entityId: base.entityId,
    dedupe: e.dedupe,
    scheduledFor: e.scheduledFor,
    context: base.context,
  }));
  const res = await prisma.notificationLog.createMany({ data, skipDuplicates: true });
  if (res.count === data.length) return data.map((d) => d.id!);
  // Nogle fandtes allerede (samtidig kørsel): find de rækker, vi selv oprettede
  const rows = await prisma.notificationLog.findMany({ where: { id: { in: data.map((d) => d.id!) } }, select: { id: true } });
  return rows.map((r) => r.id);
}

interface EnqueueArgs {
  trigger: TriggerKey;
  entityType: string;
  entityId: string;
  anchor: Date;
  dedupe: string;
  recipients: Recipient[];
  context?: Prisma.InputJsonValue;
  now?: Date;
  pastGraceMs?: number;
}

/** Opretter beskeder for alle aktive regler på en udløser (idempotent). Returnerer id'erne på de nye. */
async function enqueue(a: EnqueueArgs): Promise<string[]> {
  const now = a.now ?? new Date();
  const rules = await activeRules(a.trigger);
  if (rules.length === 0 || a.recipients.length === 0) return [];
  const [existing, settings] = await Promise.all([
    prisma.notificationLog.findMany({
      where: { entityType: a.entityType, entityId: a.entityId, trigger: a.trigger },
      select: { id: true, ruleId: true, recipientAddress: true, dedupe: true, status: true, scheduledFor: true },
    }),
    getNotificationSettings(),
  ]);
  const plan = planNotifications({
    rules,
    recipients: a.recipients,
    anchor: a.anchor,
    dedupe: a.dedupe,
    existing: existing as ExistingEntry[],
    now,
    quiet: settings.quietHours,
    pastGraceMs: a.pastGraceMs,
  });
  return insertLogs(plan.create, {
    trigger: a.trigger,
    entityType: a.entityType,
    entityId: a.entityId,
    context: a.context,
    templateKeyByRule: new Map(rules.map((r) => [r.id, r.template.key ?? r.template.name])),
  });
}

/** Sender straks de beskeder, der er forfaldne. Fejl kaster aldrig. */
async function dispatchNow(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await processDueNotifications({ ids });
  } catch (e) {
    console.error("[notifications] afsendelse fejlede", e);
  }
}

/** Fejl i notifikationer må aldrig vælte den handling, de hører til. */
async function safely<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[notifications] ${label} fejlede`, e);
    return undefined;
  }
}

// --------------------------------------------------------------------------- Udløsere: møder

async function loadMeeting(meetingId: string) {
  return prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      participants: { include: { user: true } },
      subscription: { include: { customer: { include: { user: true } } } },
    },
  });
}

function meetingRecipients(m: NonNullable<Awaited<ReturnType<typeof loadMeeting>>>): Recipient[] {
  const customerId = m.subscription.customerId;
  return m.participants.map((p) => userRecipient(p.user, p.userId === customerId ? "customer" : "advisor"));
}

export const meetingEvents = {
  /** Booket: bekræftelse straks, og påmindelser planlægges. */
  async booked(meetingId: string) {
    await safely("meeting_booked", async () => {
      const m = await loadMeeting(meetingId);
      if (!m) return;
      const ids = await enqueue({
        trigger: "meeting_booked",
        entityType: "meeting",
        entityId: m.id,
        anchor: new Date(),
        dedupe: "",
        recipients: meetingRecipients(m),
      });
      await dispatchNow(ids);
      await syncMeetingReminders(m.id);
    });
  },

  async cancelled(meetingId: string) {
    await safely("meeting_cancelled", async () => {
      const m = await loadMeeting(meetingId);
      if (!m) return;
      await syncMeetingReminders(m.id);
      const ids = await enqueue({
        trigger: "meeting_cancelled",
        entityType: "meeting",
        entityId: m.id,
        anchor: new Date(),
        dedupe: "",
        recipients: meetingRecipients(m),
      });
      await dispatchNow(ids);
    });
  },

  async rescheduled(meetingId: string) {
    await safely("meeting_rescheduled", async () => {
      const m = await loadMeeting(meetingId);
      if (!m) return;
      await syncMeetingReminders(m.id);
      const ids = await enqueue({
        trigger: "meeting_rescheduled",
        entityType: "meeting",
        entityId: m.id,
        anchor: new Date(),
        dedupe: `r${Date.now()}`,
        recipients: meetingRecipients(m),
      });
      await dispatchNow(ids);
    });
  },

  /** Rådgivere tilføjet/fjernet i ét møde. `affectedIds` får (via ADVISORS) besked; kunden via CUSTOMER. */
  async participantsChanged(meetingId: string, change: { addedIds: string[]; removedIds: string[] }) {
    await safely("meeting_participant_changed", async () => {
      const m = await loadMeeting(meetingId);
      if (!m) return;
      const affected = await prisma.user.findMany({ where: { id: { in: [...change.addedIds, ...change.removedIds] } } });
      const recipients: Recipient[] = [
        ...m.participants.filter((p) => p.userId === m.subscription.customerId).map((p) => userRecipient(p.user, "customer")),
        ...affected.map((u) => userRecipient(u, "advisor")),
      ];
      const ids = await enqueue({
        trigger: "meeting_participant_changed",
        entityType: "meeting",
        entityId: m.id,
        anchor: new Date(),
        dedupe: `c${Date.now()}`,
        recipients,
        context: change,
      });
      await dispatchNow(ids);
      await syncMeetingReminders(m.id); // nye deltagere skal have påmindelser, fjernede ikke
    });
  },

  async transcriptReady(meetingId: string) {
    await safely("transcript_ready", async () => {
      const m = await loadMeeting(meetingId);
      if (!m) return;
      const ids = await enqueue({
        trigger: "transcript_ready",
        entityType: "meeting",
        entityId: m.id,
        anchor: new Date(),
        dedupe: "",
        recipients: meetingRecipients(m),
      });
      await dispatchNow(ids);
    });
  },
};

/**
 * (Gen)planlægger påmindelserne for et møde ud fra de aktive regler: nye oprettes, ventende rettes/annulleres, når mødet er
 * flyttet eller aflyst, og sendte røres ikke. Idempotent.
 */
export async function syncMeetingReminders(meetingId: string, now = new Date()): Promise<{ created: number; cancelled: number }> {
  const m = await loadMeeting(meetingId);
  if (!m) return { created: 0, cancelled: 0 };
  const [rules, existing, settings] = await Promise.all([
    activeRules("meeting_reminder"),
    prisma.notificationLog.findMany({
      where: { entityType: "meeting", entityId: meetingId, trigger: "meeting_reminder" },
      select: { id: true, ruleId: true, recipientAddress: true, dedupe: true, status: true, scheduledFor: true },
    }),
    getNotificationSettings(),
  ]);
  const plan = planMeetingReminders({
    meeting: { startsAt: m.startsAt, status: m.status },
    rules,
    recipients: meetingRecipients(m),
    existing: existing as ExistingEntry[],
    now,
    quiet: settings.quietHours,
  });
  if (plan.cancel.length) {
    for (const c of plan.cancel) {
      await prisma.notificationLog.updateMany({ where: { id: c.id, status: "QUEUED" }, data: { status: "SKIPPED", error: c.reason } });
    }
  }
  for (const r of plan.reschedule) await prisma.notificationLog.updateMany({ where: { id: r.id, status: "QUEUED" }, data: { scheduledFor: r.scheduledFor } });
  await insertLogs(plan.create, {
    trigger: "meeting_reminder",
    entityType: "meeting",
    entityId: meetingId,
    templateKeyByRule: new Map(rules.map((r) => [r.id, r.template.key ?? r.template.name])),
  });
  return { created: plan.create.length, cancelled: plan.cancel.length };
}

// --------------------------------------------------------------------------- Udløsere: abonnement og board

export const subscriptionEvents = {
  async boardChanged(subscriptionId: string, change: { addedIds: string[]; removedIds: string[]; upcomingUpdated?: number }) {
    await safely("board_changed", async () => {
      const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { customer: { include: { user: true } } } });
      if (!sub) return;
      const affected = await prisma.user.findMany({ where: { id: { in: [...change.addedIds, ...change.removedIds] } } });
      const ids = await enqueue({
        trigger: "board_changed",
        entityType: "subscription",
        entityId: sub.id,
        anchor: new Date(),
        dedupe: `c${Date.now()}`,
        recipients: [userRecipient(sub.customer.user, "customer"), ...affected.map((u) => userRecipient(u, "advisor"))],
        context: change,
      });
      await dispatchNow(ids);
    });
  },

  async paymentFailed(subscriptionId: string) {
    await safely("payment_failed", async () => {
      const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { customer: { include: { user: true } } } });
      if (!sub) return;
      const ids = await enqueue({
        trigger: "payment_failed",
        entityType: "subscription",
        entityId: sub.id,
        anchor: new Date(),
        // Én serie pr. gang abonnementet går i PAST_DUE
        dedupe: `p${Date.now()}`,
        recipients: [userRecipient(sub.customer.user, "customer")],
      });
      await dispatchNow(ids);
    });
  },
};

// --------------------------------------------------------------------------- Udløsere: konto (transaktionelle, med engangslinks)

async function sendSubjectNow(trigger: "advisor_invited" | "password_reset", user: User, vars: Record<string, string>): Promise<boolean> {
  const result = await safely(trigger, async () => {
    const ids = await enqueue({
      trigger,
      entityType: "user",
      entityId: user.id,
      anchor: new Date(),
      dedupe: `t${Date.now()}`,
      recipients: [userRecipient(user, "subject")],
    });
    let ok = false;
    for (const id of ids) {
      const r = await deliverLog(id, { extraVars: vars });
      if (r === "SENT") ok = true;
    }
    return ok;
  });
  return result === true;
}

export const accountEvents = {
  invited: (user: User, link: string) => sendSubjectNow("advisor_invited", user, { invitationslink: link }),
  passwordReset: (user: User, link: string) => sendSubjectNow("password_reset", user, { nulstillingslink: link }),
};

// --------------------------------------------------------------------------- Udløser: ufærdig tilmelding

/**
 * Finder leads med aktivt markedsføringssamtykke, hvis tilmelding ikke er gjort færdig, og opretter de beskeder, der er
 * forfaldne (offset efter sidste aktivitet). Stopper automatisk for gennemførte (konto findes), udløbne tilmeldinger
 * og tilbagetrukne samtykker.
 */
export async function scanAbandonedOnboarding(now = new Date()): Promise<number> {
  const rules = await activeRules("onboarding_abandoned");
  if (rules.length === 0) return 0;
  const minOffset = Math.min(...rules.map((r) => r.offsetMinutes));
  const leads = await prisma.lead.findMany({
    where: {
      convertedAt: null,
      lastActivityAt: { lte: new Date(now.getTime() - minOffset * 60_000) },
      sessions: { some: { expiresAt: { gt: now } } },
      consents: { some: { OR: [{ emailConsent: true, emailWithdrawnAt: null }, { smsConsent: true, smsWithdrawnAt: null }] } },
    },
    take: 200,
  });
  let created = 0;
  for (const l of leads) {
    if (await prisma.user.findUnique({ where: { email: l.email }, select: { id: true } })) continue;
    const ids = await enqueue({
      trigger: "onboarding_abandoned",
      entityType: "lead",
      entityId: l.id,
      anchor: l.lastActivityAt,
      dedupe: "",
      now,
      pastGraceMs: 12 * 3_600_000,
      recipients: [{ userId: null, name: l.name, email: l.email, phone: l.phone, audiences: ["SUBJECT"], kind: "subject" }],
    });
    created += ids.length;
  }
  return created;
}

// --------------------------------------------------------------------------- Afsendelse

const CLAIM_TIMEOUT_MS = 5 * 60_000;

/** Henter forfaldne beskeder atomisk (FOR UPDATE SKIP LOCKED) og sender dem. */
export async function processDueNotifications(opts: { limit?: number; ids?: string[]; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 50;
  const stale = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const rows = opts.ids
    ? await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "NotificationLog" SET "claimedAt" = ${now}
        WHERE id IN (
          SELECT id FROM "NotificationLog"
          WHERE status = 'QUEUED' AND "scheduledFor" <= ${now} AND ("claimedAt" IS NULL OR "claimedAt" < ${stale}) AND id = ANY(${opts.ids})
          ORDER BY "scheduledFor" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED)
        RETURNING id`
    : await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "NotificationLog" SET "claimedAt" = ${now}
        WHERE id IN (
          SELECT id FROM "NotificationLog"
          WHERE status = 'QUEUED' AND "scheduledFor" <= ${now} AND ("claimedAt" IS NULL OR "claimedAt" < ${stale})
          ORDER BY "scheduledFor" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED)
        RETURNING id`;
  let sent = 0;
  for (const r of rows) {
    const res = await deliverLog(r.id, { now });
    if (res === "SENT") sent++;
  }
  return sent;
}

type DeliverResult = "SENT" | "SKIPPED" | "FAILED" | "RESCHEDULED" | "GONE";

async function skip(id: string, reason: string): Promise<DeliverResult> {
  await prisma.notificationLog.updateMany({ where: { id, status: "QUEUED" }, data: { status: "SKIPPED", error: reason, claimedAt: null } });
  return "SKIPPED";
}

/** Modtageren har afmeldt kanalen, eller (for markedsføring) mangler et aktivt samtykke. */
async function isOptedOut(
  def: TriggerDef,
  log: { channel: NotificationChannel; recipient: User | null; entityType: string; entityId: string; recipientAddress: string },
): Promise<boolean> {
  if (log.recipient && (log.channel === "EMAIL" ? log.recipient.emailOptOutAt : log.recipient.smsOptOutAt)) return true;
  if (!def.optIn) return false;
  // Markedsføring og opfølgning til ikke-kunder kræver et aktivt samtykke for kanalen
  if (log.entityType === "lead") {
    const lead = await prisma.lead.findUnique({ where: { id: log.entityId } });
    if (!lead) return true;
    if (log.channel === "SMS" && toE164(lead.phone) !== log.recipientAddress) return true;
    return !(await hasMarketingConsent(log.channel, { email: lead.email, phone: lead.phone }));
  }
  const email = log.recipient?.email ?? log.recipientAddress;
  return !(await hasMarketingConsent(log.channel, { email, phone: log.recipient?.phone ?? null }));
}

/** Tilstandstjek lige før afsendelse: er beskeden stadig relevant? Returnerer en årsag til at springe over. */
async function entityGuard(def: TriggerDef, log: { entityType: string; entityId: string; dedupe: string; recipientUserId: string | null }, now: Date): Promise<{ reason?: string; meetingStart?: Date; notBefore?: Date }> {
  if (log.entityType === "meeting") {
    const m = await prisma.meeting.findUnique({ where: { id: log.entityId }, select: { status: true, startsAt: true } });
    if (!m) return { reason: "Mødet findes ikke længere" };
    switch (def.key) {
      case "meeting_reminder":
        if (m.status !== "BOOKED") return { reason: "Mødet er ikke længere booket" };
        if (log.dedupe !== reminderDedupe(m.startsAt)) return { reason: "Mødet er flyttet" };
        if (m.startsAt <= now) return { reason: "Mødet er allerede startet" };
        if (log.recipientUserId && !(await prisma.meetingParticipant.findUnique({ where: { meetingId_userId: { meetingId: log.entityId, userId: log.recipientUserId } } }))) {
          return { reason: "Modtageren deltager ikke længere i mødet" };
        }
        break;
      case "meeting_cancelled":
        if (m.status !== "CANCELLED") return { reason: "Mødet er ikke aflyst" };
        break;
      case "meeting_booked":
      case "meeting_rescheduled":
      case "meeting_participant_changed":
        if (m.status === "CANCELLED") return { reason: "Mødet er aflyst" };
        break;
    }
    return { meetingStart: m.startsAt };
  }
  if (def.key === "payment_failed") {
    const s = await prisma.subscription.findUnique({ where: { id: log.entityId }, select: { status: true } });
    if (!s || s.status !== "PAST_DUE") return { reason: "Betalingen mangler ikke længere" };
  }
  if (def.key === "onboarding_abandoned") {
    const l = await prisma.lead.findUnique({ where: { id: log.entityId }, include: { sessions: { select: { expiresAt: true } } } });
    if (!l || l.convertedAt) return { reason: "Tilmeldingen er gennemført" };
    if (!l.sessions.some((x) => x.expiresAt > now)) return { reason: "Tilmeldingen er udløbet" };
    if (await prisma.user.findUnique({ where: { email: l.email }, select: { id: true } })) return { reason: "Kontoen er oprettet" };
    // Har personen været aktiv igen siden planlægningen, flyttes beskeden (offset regnes fra seneste aktivitet)
    return { notBefore: l.lastActivityAt };
  }
  return {};
}

/** Variabler til én besked, hentet friskt fra databasen. */
async function buildVariables(
  def: TriggerDef,
  log: { channel: NotificationChannel; entityType: string; entityId: string; recipientAddress: string; context: unknown },
  recipient: User | null,
  extra: Record<string, string>,
): Promise<Record<string, string>> {
  const base = appUrl();
  let name = recipient?.name ?? "";
  const vars: Record<string, string> = {};
  const ctx = (log.context ?? {}) as { addedIds?: string[]; removedIds?: string[]; upcomingUpdated?: number };

  const changeVars = async (scope: "meeting" | "board", recipientId: string | null, isCustomer: boolean) => {
    const ids = [...(ctx.addedIds ?? []), ...(ctx.removedIds ?? [])];
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "";
    const added = (ctx.addedIds ?? []).map(nameOf).filter(Boolean);
    const removed = (ctx.removedIds ?? []).map(nameOf).filter(Boolean);
    const role: ChangeRole = isCustomer ? "customer" : (ctx.addedIds ?? []).includes(recipientId ?? "") ? "added" : "removed";
    vars["ændring"] = describeChange({ scope, role, added, removed, upcomingUpdated: ctx.upcomingUpdated });
    vars["ny_rådgiver"] = joinNames(added);
    vars["fjernet_rådgiver"] = joinNames(removed);
  };

  if (log.entityType === "meeting") {
    const m = await loadMeeting(log.entityId);
    if (m) {
      const advisors = m.participants.filter((p) => p.userId !== m.subscription.customerId).map((p) => p.user.name);
      const isParticipant = m.participants.some((p) => p.userId === recipient?.id);
      Object.assign(vars, meetingDateVars(m.startsAt), {
        virksomhed: m.subscription.customer.companyName,
        rådgivere: joinNames(advisors),
        mødelink: isParticipant ? `${base}/meetings/${m.id}` : `${base}/dashboard`,
      });
      if (def.key === "meeting_participant_changed") await changeVars("meeting", recipient?.id ?? null, recipient?.id === m.subscription.customerId);
    }
  } else if (log.entityType === "subscription") {
    const sub = await prisma.subscription.findUnique({
      where: { id: log.entityId },
      include: { customer: true, advisors: { include: { advisor: { include: { user: true } } } } },
    });
    if (sub) {
      vars.virksomhed = sub.customer.companyName;
      vars["rådgivere"] = joinNames(sub.advisors.map((a) => a.advisor.user.name));
      vars.kontolink = recipient?.role === "CUSTOMER" ? `${base}/account/subscription` : `${base}/dashboard`;
      if (def.key === "board_changed") await changeVars("board", recipient?.id ?? null, recipient?.id === sub.customerId);
    }
  } else if (log.entityType === "lead") {
    const l = await prisma.lead.findUnique({ where: { id: log.entityId } });
    name = l?.name ?? name;
    vars.onboardinglink = `${base}/kom-i-gang`;
  }

  vars.fornavn = firstName(name);
  vars.navn = name;
  vars.afmeldlink = unsubscribeUrl({ channel: log.channel, address: log.recipientAddress });
  return { ...vars, ...extra };
}

/** Sender én besked fra køen. Springer over, hvis den ikke længere er relevant, og udsætter SMS i stille timer. */
export async function deliverLog(id: string, opts: { extraVars?: Record<string, string>; now?: Date } = {}): Promise<DeliverResult> {
  const now = opts.now ?? new Date();
  const log = await prisma.notificationLog.findUnique({ where: { id }, include: { rule: { include: { template: true } }, recipient: true } });
  if (!log || log.status !== "QUEUED") return "GONE";
  const def = isTriggerKey(log.trigger) ? TRIGGERS[log.trigger] : null;
  if (!def || !log.rule) return skip(id, "Reglen findes ikke længere");
  const { rule } = log;
  const { template } = rule;
  if (!def.locked) {
    if (!rule.active) return skip(id, "Reglen er slået fra");
    if (!template.active) return skip(id, "Skabelonen er slået fra");
    if (await isOptedOut(def, log)) return skip(id, log.channel === "SMS" ? "Modtageren har afmeldt SMS" : "Modtageren har afmeldt e-mail");
  }
  const guard = await entityGuard(def, log, now);
  if (guard.reason) return skip(id, guard.reason);
  if (guard.notBefore) {
    const due = new Date(guard.notBefore.getTime() + rule.offsetMinutes * 60_000);
    if (due.getTime() > now.getTime() + 60_000) {
      await prisma.notificationLog.updateMany({ where: { id, status: "QUEUED" }, data: { scheduledFor: due, claimedAt: null } });
      return "RESCHEDULED";
    }
  }

  if (log.channel === "SMS" && rule.quietHours) {
    const settings = await getNotificationSettings();
    const adj = adjustForQuietHours({ at: now, channel: "SMS", ruleQuiet: true, quiet: settings.quietHours, meetingStart: guard.meetingStart });
    if (adj.delayed) {
      if (!adj.at) return skip(id, "Stille timer – mødet er begyndt, inden SMS'en kunne sendes");
      await prisma.notificationLog.updateMany({ where: { id, status: "QUEUED" }, data: { scheduledFor: adj.at, claimedAt: null } });
      return "RESCHEDULED";
    }
  }

  try {
    const vars = await buildVariables(def, log, log.recipient, opts.extraVars ?? {});
    const body = renderTemplate(template.body, vars);
    let result: { providerMessageId: string };
    let subject: string | null = null;
    let sentText: string;
    if (log.channel === "EMAIL") {
      subject = renderTemplate(template.subject ?? "", vars).trim();
      const mail = buildEmail({ subject, bodyText: body, unsubscribeUrl: def.optIn ? vars.afmeldlink : undefined, baseUrl: appUrl() });
      sentText = mail.text;
      result = await getEmail().send({ to: log.recipientAddress, toName: vars.navn || undefined, subject, text: mail.text, html: mail.html, messageId: log.id });
    } else {
      const settings = await getNotificationSettings();
      sentText = def.optIn && !body.includes(vars.afmeldlink) ? `${body}\nAfmeld: ${vars.afmeldlink}` : body;
      result = await getSms().send({ to: log.recipientAddress, text: sentText, from: settings.smsSender, messageId: log.id });
    }
    await prisma.notificationLog.update({
      where: { id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        providerMessageId: result.providerMessageId,
        subject,
        preview: def.sensitive ? null : sentText.slice(0, 400),
        error: null,
        claimedAt: null,
      },
    });
    return "SENT";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[notifications] ${log.trigger} til ${log.recipientAddress} fejlede`, message);
    await prisma.notificationLog.update({ where: { id }, data: { status: "FAILED", error: message.slice(0, 500), claimedAt: null } });
    return "FAILED";
  }
}

/** "Send igen": sætter en mislykket besked i kø igen og sender den. Beskeder med engangslinks kan ikke gensendes. */
export async function resendLog(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const log = await prisma.notificationLog.findUnique({ where: { id } });
  if (!log) return { ok: false, error: "Beskeden findes ikke." };
  if (log.status !== "FAILED") return { ok: false, error: "Kun mislykkede beskeder kan sendes igen." };
  if (isTriggerKey(log.trigger) && TRIGGERS[log.trigger].sensitive) {
    return { ok: false, error: "Beskeder med engangslink kan ikke sendes igen. Send en ny invitation eller nulstilling." };
  }
  if (log.entityType === "test") return { ok: false, error: "Send testen igen fra skabelonen." };
  await prisma.notificationLog.update({ where: { id }, data: { status: "QUEUED", scheduledFor: new Date(), claimedAt: null, error: null } });
  const r = await deliverLog(id);
  return r === "SENT" ? { ok: true } : { ok: false, error: (await prisma.notificationLog.findUnique({ where: { id } }))?.error ?? "Afsendelsen mislykkedes." };
}

// --------------------------------------------------------------------------- Test fra CMS'et

export function sampleVariables(): Record<string, string> {
  const base = appUrl();
  return Object.fromEntries(Object.entries(VARIABLES).map(([k, v]) => [k, v.sample.replace("{APP}", base)]));
}

/** Sender en testbesked med eksempeldata via den rigtige adapter (console i udvikling) og skriver den i loggen. */
export async function sendTestMessage(opts: {
  channel: NotificationChannel;
  subject?: string | null;
  body: string;
  to: string;
  userId: string;
  templateKey: string;
}): Promise<{ ok: true; logId: string } | { ok: false; error: string }> {
  const address = opts.channel === "SMS" ? toE164(opts.to) : opts.to.trim();
  if (!address || (opts.channel === "EMAIL" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address))) {
    return { ok: false, error: opts.channel === "SMS" ? "Indtast et gyldigt telefonnummer, fx 20 30 40 50." : "Indtast en gyldig e-mailadresse." };
  }
  const vars = sampleVariables();
  const logId = randomUUID();
  await prisma.notificationLog.create({
    data: {
      id: logId,
      templateKey: opts.templateKey,
      trigger: "test",
      channel: opts.channel,
      recipientUserId: opts.userId,
      recipientAddress: address,
      entityType: "test",
      entityId: logId,
      dedupe: logId,
      scheduledFor: new Date(),
    },
  });
  try {
    const body = renderTemplate(opts.body, vars);
    let providerMessageId: string;
    let subject: string | null = null;
    let sentText: string;
    if (opts.channel === "EMAIL") {
      subject = `[Test] ${renderTemplate(opts.subject ?? "", vars).trim()}`;
      const mail = buildEmail({ subject, bodyText: body, baseUrl: appUrl() });
      sentText = mail.text;
      providerMessageId = (await getEmail().send({ to: address, subject, text: mail.text, html: mail.html, messageId: logId })).providerMessageId;
    } else {
      const settings = await getNotificationSettings();
      sentText = `[Test] ${body}`;
      providerMessageId = (await getSms().send({ to: address, text: sentText, from: settings.smsSender, messageId: logId })).providerMessageId;
    }
    await prisma.notificationLog.update({
      where: { id: logId },
      data: { status: "SENT", sentAt: new Date(), providerMessageId, subject, preview: sentText.slice(0, 400) },
    });
    return { ok: true, logId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.notificationLog.update({ where: { id: logId }, data: { status: "FAILED", error: message.slice(0, 500) } });
    return { ok: false, error: `Testen kunne ikke sendes: ${message}` };
  }
}

// --------------------------------------------------------------------------- Afmelding, statuswebhook, oprydning

/** Registrerer en afmelding for en adresse. Returnerer hvor mange konti/tilmeldinger, der blev opdateret. */
export async function applyUnsubscribe(channel: NotificationChannel, address: string): Promise<number> {
  let n = 0;
  if (channel === "EMAIL") {
    const r = await prisma.user.updateMany({ where: { email: { equals: address, mode: "insensitive" } }, data: { emailOptOutAt: new Date() } });
    n += r.count;
  } else {
    const candidates = await prisma.user.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } });
    const ids = candidates.filter((u) => toE164(u.phone) === address).map((u) => u.id);
    if (ids.length) n += (await prisma.user.updateMany({ where: { id: { in: ids } }, data: { smsOptOutAt: new Date() } })).count;
  }
  n += await withdrawMarketing(channel, address);
  return n;
}

/** Statusopdatering fra udbyderen (webhook): matcher på udbyderens besked-id eller vores eget id. */
export async function applyDeliveryStatus(events: { messageId: string; status: "DELIVERED" | "FAILED"; error?: string }[]): Promise<number> {
  let n = 0;
  for (const e of events) {
    const r = await prisma.notificationLog.updateMany({
      where: { OR: [{ providerMessageId: e.messageId }, { id: e.messageId }], status: { in: ["SENT", "DELIVERED"] } },
      data: e.status === "DELIVERED" ? { status: "DELIVERED" } : { status: "FAILED", error: e.error ?? "Leveringen mislykkedes" },
    });
    n += r.count;
  }
  return n;
}

/** GDPR: sletter loggen ældre end opbevaringsperioden. */
export async function cleanupNotificationLogs(now = new Date()): Promise<number> {
  const { logRetentionMonths } = await getNotificationSettings();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - logRetentionMonths);
  const r = await prisma.notificationLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return r.count;
}

/** GDPR: sletter alle notifikationslog-rækker, der hører til en person (konto-id, e-mail eller telefonnummer). */
export async function deleteNotificationDataFor(user: Pick<User, "id" | "email" | "phone">): Promise<number> {
  const addresses = [user.email.toLowerCase(), toE164(user.phone)].filter((a): a is string => Boolean(a));
  const r = await prisma.notificationLog.deleteMany({
    where: { OR: [{ recipientUserId: user.id }, { recipientAddress: { in: addresses, mode: "insensitive" } }] },
  });
  return r.count;
}

/** Opretter et tilbagevendende job, hvis det ikke har kørt for nylig. */
export async function ensureRecurringJob(type: string, everyMs: number): Promise<boolean> {
  const last = await prisma.job.findFirst({ where: { type }, orderBy: { createdAt: "desc" }, select: { createdAt: true, status: true } });
  if (last && (last.status === "PENDING" || last.status === "RUNNING" || Date.now() - last.createdAt.getTime() < everyMs)) return false;
  await prisma.job.create({ data: { type, payload: {} } });
  return true;
}
