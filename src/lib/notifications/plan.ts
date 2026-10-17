import type { NotificationAudience, NotificationChannel, NotificationStatus } from "@prisma/client";
import { toE164 } from "../phone";
import { adjustForQuietHours, fireTime, type QuietHours } from "./timing";

/** Det planlæggeren har brug for om en regel. */
export interface PlanRule {
  id: string;
  offsetMinutes: number;
  channel: NotificationChannel;
  audience: NotificationAudience;
  quietHours: boolean;
}

export interface PlanRecipient {
  userId: string | null;
  email: string;
  phone: string | null;
  /** Hvilke målgrupper modtageren tilhører (kunder: CUSTOMER + BOTH, rådgivere: ADVISORS + BOTH, personen selv: SUBJECT) */
  audiences: NotificationAudience[];
}

export interface ExistingEntry {
  id: string;
  ruleId: string | null;
  recipientAddress: string;
  dedupe: string;
  status: NotificationStatus;
  scheduledFor: Date;
}

export interface PlannedEntry {
  ruleId: string;
  recipientUserId: string | null;
  recipientAddress: string;
  channel: NotificationChannel;
  dedupe: string;
  scheduledFor: Date;
}

export const PAST_GRACE_MS = 5 * 60_000;

/** Adressen en besked sendes til: e-mail, eller telefonnummer i E.164 (null = kan ikke sendes). */
export function addressFor(channel: NotificationChannel, r: Pick<PlanRecipient, "email" | "phone">): string | null {
  return channel === "EMAIL" ? r.email || null : toE164(r.phone);
}

export const entryKey = (ruleId: string | null, address: string, dedupe: string) => `${ruleId ?? "-"}|${address}|${dedupe}`;

export interface PlanInput {
  rules: PlanRule[];
  recipients: PlanRecipient[];
  /** Hændelsen reglens offset regnes fra: mødets start, hændelsestidspunktet eller seneste aktivitet */
  anchor: Date;
  dedupe: string;
  existing: ExistingEntry[];
  now: Date;
  quiet: QuietHours | null;
  /** Kun for påmindelser: mødets start (til undtagelsen fra stille timer) */
  meetingStart?: Date;
  /** Hvor langt tilbage et planlagt tidspunkt må ligge, før det springes over (standard 5 min.) */
  pastGraceMs?: number;
}

export interface PlanResult {
  /** Nøgler (regel, adresse, dedupe) for alle beskeder, planen ønsker – også de, der allerede findes */
  keys: Set<string>;
  create: PlannedEntry[];
  /** Eksisterende ventende beskeder, hvis tidspunkt skal rettes */
  reschedule: { id: string; scheduledFor: Date }[];
}

/**
 * Ren planlægning: hvilke beskeder skal oprettes ud fra reglerne? Idempotent – en besked, der allerede findes for
 * (regel, modtager, dedupe), oprettes ikke igen. Tidspunkter, der for længst er passeret (mere end 5 min.), springes over.
 */
export function planNotifications(input: PlanInput): PlanResult {
  const existing = new Map(input.existing.map((e) => [entryKey(e.ruleId, e.recipientAddress, e.dedupe), e]));
  const create: PlannedEntry[] = [];
  const reschedule: PlanResult["reschedule"] = [];
  const seen = new Set<string>();

  for (const rule of input.rules) {
    for (const r of input.recipients) {
      if (!r.audiences.includes(rule.audience)) continue;
      const address = addressFor(rule.channel, r);
      if (!address) continue;
      const key = entryKey(rule.id, address, input.dedupe);
      if (seen.has(key)) continue;
      seen.add(key);

      const raw = fireTime(input.anchor, rule.offsetMinutes);
      const adj = adjustForQuietHours({ at: raw, channel: rule.channel, ruleQuiet: rule.quietHours, quiet: input.quiet, meetingStart: input.meetingStart });
      const prior = existing.get(key);
      if (prior) {
        if (prior.status === "QUEUED" && adj.at && Math.abs(prior.scheduledFor.getTime() - adj.at.getTime()) > 1000) {
          reschedule.push({ id: prior.id, scheduledFor: adj.at });
        }
        continue;
      }
      if (!adj.at) continue;
      if (adj.at.getTime() < input.now.getTime() - (input.pastGraceMs ?? PAST_GRACE_MS)) continue;
      create.push({
        ruleId: rule.id,
        recipientUserId: r.userId,
        recipientAddress: address,
        channel: rule.channel,
        dedupe: input.dedupe,
        scheduledFor: adj.at.getTime() < input.now.getTime() ? input.now : adj.at,
      });
    }
  }
  return { keys: seen, create, reschedule };
}

export const reminderDedupe = (startsAt: Date) => `s${Math.floor(startsAt.getTime() / 60_000)}`;

export interface ReminderPlanInput extends Omit<PlanInput, "anchor" | "dedupe" | "meetingStart"> {
  meeting: { startsAt: Date; status: "BOOKED" | "COMPLETED" | "CANCELLED" };
}

export interface ReminderPlanResult extends PlanResult {
  /** Ventende påmindelser, der skal annulleres (mødet er aflyst/flyttet, eller reglen er væk) */
  cancel: { id: string; reason: string }[];
}

/**
 * Påmindelser for ét møde. Aflyst/afholdt møde: alle ventende påmindelser annulleres. Flyttet møde: ventende påmindelser
 * til det gamle tidspunkt annulleres, og nye planlægges ud fra det nye. Allerede sendte påmindelser røres ikke.
 */
export function planMeetingReminders(input: ReminderPlanInput): ReminderPlanResult {
  const queued = input.existing.filter((e) => e.status === "QUEUED");
  if (input.meeting.status !== "BOOKED") {
    return {
      keys: new Set(),
      create: [],
      reschedule: [],
      cancel: queued.map((e) => ({ id: e.id, reason: input.meeting.status === "CANCELLED" ? "Mødet er aflyst" : "Mødet er afholdt" })),
    };
  }
  const dedupe = reminderDedupe(input.meeting.startsAt);
  const plan = planNotifications({ ...input, anchor: input.meeting.startsAt, dedupe, meetingStart: input.meeting.startsAt });
  const activeRuleIds = new Set(input.rules.map((r) => r.id));
  const cancel = queued
    .filter((e) => e.dedupe !== dedupe || !e.ruleId || !activeRuleIds.has(e.ruleId) || !plan.keys.has(entryKey(e.ruleId, e.recipientAddress, e.dedupe)))
    .map((e) => ({
      id: e.id,
      reason:
        e.dedupe !== dedupe
          ? "Mødet er flyttet"
          : !e.ruleId || !activeRuleIds.has(e.ruleId)
            ? "Reglen er ændret eller slået fra"
            : "Modtageren deltager ikke længere i mødet",
    }));
  const cancelled = new Set(cancel.map((c) => c.id));
  return { ...plan, reschedule: plan.reschedule.filter((r) => !cancelled.has(r.id)), cancel };
}
