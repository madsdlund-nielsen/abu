import { describe, expect, it } from "vitest";
import { addressFor, planMeetingReminders, planNotifications, reminderDedupe, type ExistingEntry, type PlanRecipient, type PlanRule } from "./plan";
import { parseQuietHours } from "./timing";

const now = new Date("2026-11-10T09:00:00Z");
const start = new Date("2026-11-12T09:00:00Z"); // torsdag 10:00 CET
const quiet = parseQuietHours("21-08");

const rules: PlanRule[] = [
  { id: "r-mail-24h", offsetMinutes: -1440, channel: "EMAIL", audience: "BOTH", quietHours: false },
  { id: "r-sms-60", offsetMinutes: -60, channel: "SMS", audience: "BOTH", quietHours: true },
];
const customer: PlanRecipient = { userId: "c", email: "kunde@abu.local", phone: "+45 12 34 56 78", audiences: ["CUSTOMER", "BOTH"] };
const advisor: PlanRecipient = { userId: "a", email: "raadgiver@abu.local", phone: null, audiences: ["ADVISORS", "BOTH"] };
const booked = { startsAt: start, status: "BOOKED" as const };

describe("planMeetingReminders", () => {
  it("planlægger e-mail 24 t før og SMS 60 min før (kun til dem med telefonnummer)", () => {
    const p = planMeetingReminders({ meeting: booked, rules, recipients: [customer, advisor], existing: [], now, quiet });
    expect(p.create.map((c) => [c.ruleId, c.recipientAddress, c.scheduledFor.toISOString()])).toEqual([
      ["r-mail-24h", "kunde@abu.local", "2026-11-11T09:00:00.000Z"],
      ["r-mail-24h", "raadgiver@abu.local", "2026-11-11T09:00:00.000Z"],
      ["r-sms-60", "+4512345678", "2026-11-12T08:00:00.000Z"],
    ]);
    expect(p.cancel).toEqual([]);
  });

  it("er idempotent: en ny kørsel med de oprettede rækker opretter ingenting", () => {
    const first = planMeetingReminders({ meeting: booked, rules, recipients: [customer, advisor], existing: [], now, quiet });
    const existing: ExistingEntry[] = first.create.map((c, i) => ({ id: `e${i}`, ruleId: c.ruleId, recipientAddress: c.recipientAddress, dedupe: c.dedupe, status: "QUEUED", scheduledFor: c.scheduledFor }));
    const second = planMeetingReminders({ meeting: booked, rules, recipients: [customer, advisor], existing, now, quiet });
    expect(second.create).toEqual([]);
    expect(second.cancel).toEqual([]);
    expect(second.reschedule).toEqual([]);
  });

  it("opretter ikke igen, hvis en påmindelse allerede er sendt", () => {
    const existing: ExistingEntry[] = [{ id: "x", ruleId: "r-mail-24h", recipientAddress: "kunde@abu.local", dedupe: reminderDedupe(start), status: "SENT", scheduledFor: new Date("2026-11-11T09:00:00Z") }];
    const p = planMeetingReminders({ meeting: booked, rules, recipients: [customer], existing, now: new Date("2026-11-11T10:00:00Z"), quiet });
    expect(p.create.find((c) => c.ruleId === "r-mail-24h")).toBeUndefined();
  });

  it("springer påmindelser over, hvis tidspunktet allerede er passeret (kort varsel)", () => {
    const lateNow = new Date("2026-11-11T20:00:00Z"); // mindre end 24 t til mødet
    const p = planMeetingReminders({ meeting: booked, rules, recipients: [customer], existing: [], now: lateNow, quiet });
    expect(p.create.map((c) => c.ruleId)).toEqual(["r-sms-60"]);
  });

  it("aflysning annullerer ventende påmindelser, men ikke sendte", () => {
    const existing: ExistingEntry[] = [
      { id: "q1", ruleId: "r-sms-60", recipientAddress: "+4512345678", dedupe: reminderDedupe(start), status: "QUEUED", scheduledFor: new Date("2026-11-12T08:00:00Z") },
      { id: "s1", ruleId: "r-mail-24h", recipientAddress: "kunde@abu.local", dedupe: reminderDedupe(start), status: "SENT", scheduledFor: new Date("2026-11-11T09:00:00Z") },
    ];
    const p = planMeetingReminders({ meeting: { startsAt: start, status: "CANCELLED" }, rules, recipients: [customer], existing, now, quiet });
    expect(p.create).toEqual([]);
    expect(p.cancel).toEqual([{ id: "q1", reason: "Mødet er aflyst" }]);
  });

  it("flytning genberegner: gamle ventende annulleres, nye planlægges ud fra det nye tidspunkt", () => {
    const existing: ExistingEntry[] = [
      { id: "q1", ruleId: "r-sms-60", recipientAddress: "+4512345678", dedupe: reminderDedupe(start), status: "QUEUED", scheduledFor: new Date("2026-11-12T08:00:00Z") },
      { id: "q2", ruleId: "r-mail-24h", recipientAddress: "kunde@abu.local", dedupe: reminderDedupe(start), status: "QUEUED", scheduledFor: new Date("2026-11-11T09:00:00Z") },
    ];
    const moved = new Date("2026-11-19T12:00:00Z"); // 13:00 CET en uge senere
    const p = planMeetingReminders({ meeting: { startsAt: moved, status: "BOOKED" }, rules, recipients: [customer], existing, now, quiet });
    expect(p.cancel.map((c) => [c.id, c.reason])).toEqual([["q1", "Mødet er flyttet"], ["q2", "Mødet er flyttet"]]);
    expect(p.create.map((c) => c.scheduledFor.toISOString()).sort()).toEqual(["2026-11-18T12:00:00.000Z", "2026-11-19T11:00:00.000Z"]);
    expect(new Set(p.create.map((c) => c.dedupe))).toEqual(new Set([reminderDedupe(moved)]));
  });

  it("annullerer ventende påmindelser fra regler, der er slået fra eller slettet", () => {
    const existing: ExistingEntry[] = [{ id: "q9", ruleId: "r-gammel", recipientAddress: "kunde@abu.local", dedupe: reminderDedupe(start), status: "QUEUED", scheduledFor: new Date("2026-11-11T09:00:00Z") }];
    const p = planMeetingReminders({ meeting: booked, rules, recipients: [customer], existing, now, quiet });
    expect(p.cancel).toEqual([{ id: "q9", reason: "Reglen er ændret eller slået fra" }]);
  });

  it("annullerer ventende påmindelser til en modtager, der ikke længere deltager (udskiftet rådgiver)", () => {
    const existing: ExistingEntry[] = [
      { id: "a-mail", ruleId: "r-mail-24h", recipientAddress: "raadgiver@abu.local", dedupe: reminderDedupe(start), status: "QUEUED", scheduledFor: new Date("2026-11-11T09:00:00Z") },
      { id: "k-mail", ruleId: "r-mail-24h", recipientAddress: "kunde@abu.local", dedupe: reminderDedupe(start), status: "QUEUED", scheduledFor: new Date("2026-11-11T09:00:00Z") },
    ];
    const p = planMeetingReminders({ meeting: booked, rules, recipients: [customer], existing, now, quiet });
    expect(p.cancel).toEqual([{ id: "a-mail", reason: "Modtageren deltager ikke længere i mødet" }]);
  });

  it("rette tidspunktet for en ventende SMS, når stille timer ændres", () => {
    // Møde kl. 10:00 CET; SMS-regel 12 timer før = 21:00 CET dagen før → i de stille timer → 08:00
    const r12: PlanRule = { id: "r12", offsetMinutes: -720, channel: "SMS", audience: "CUSTOMER", quietHours: true };
    const existing: ExistingEntry[] = [{ id: "q", ruleId: "r12", recipientAddress: "+4512345678", dedupe: reminderDedupe(start), status: "QUEUED", scheduledFor: new Date("2026-11-11T20:00:00Z") }];
    const p = planMeetingReminders({ meeting: booked, rules: [r12], recipients: [customer], existing, now, quiet });
    expect(p.reschedule).toEqual([{ id: "q", scheduledFor: new Date("2026-11-12T07:00:00Z") }]);
  });

  it("SMS-påmindelse 12 t før (21:00) udsættes til 08:00 (stille timer)", () => {
    const r12: PlanRule = { id: "r12", offsetMinutes: -720, channel: "SMS", audience: "CUSTOMER", quietHours: true };
    const p = planMeetingReminders({ meeting: booked, rules: [r12], recipients: [customer], existing: [], now, quiet });
    expect(p.create[0].scheduledFor.toISOString()).toBe("2026-11-12T07:00:00.000Z"); // 08:00 CET
    const free = planMeetingReminders({ meeting: booked, rules: [{ ...r12, quietHours: false }], recipients: [customer], existing: [], now, quiet });
    expect(free.create[0].scheduledFor.toISOString()).toBe("2026-11-11T21:00:00.000Z");
  });
});

describe("planNotifications (hændelser)", () => {
  const rule: PlanRule = { id: "r1", offsetMinutes: 0, channel: "EMAIL", audience: "CUSTOMER", quietHours: false };
  it("sender kun til den valgte målgruppe", () => {
    const p = planNotifications({ rules: [rule], recipients: [customer, advisor], anchor: now, dedupe: "", existing: [], now, quiet });
    expect(p.create.map((c) => c.recipientAddress)).toEqual(["kunde@abu.local"]);
  });
  it("er idempotent for samme hændelse (dedupe) men tillader en ny hændelse", () => {
    const first = planNotifications({ rules: [rule], recipients: [customer], anchor: now, dedupe: "c1", existing: [], now, quiet });
    const existing: ExistingEntry[] = [{ id: "e", ruleId: "r1", recipientAddress: "kunde@abu.local", dedupe: "c1", status: "SENT", scheduledFor: now }];
    expect(first.create).toHaveLength(1);
    expect(planNotifications({ rules: [rule], recipients: [customer], anchor: now, dedupe: "c1", existing, now, quiet }).create).toEqual([]);
    expect(planNotifications({ rules: [rule], recipients: [customer], anchor: now, dedupe: "c2", existing, now, quiet }).create).toHaveLength(1);
  });
  it("offset efter hændelsen: forfalder først senere, og sene scans udelades efter grace", () => {
    const later: PlanRule = { ...rule, offsetMinutes: 60, audience: "SUBJECT" };
    const subject: PlanRecipient = { userId: null, email: "lead@x.dk", phone: null, audiences: ["SUBJECT"] };
    const p = planNotifications({ rules: [later], recipients: [subject], anchor: now, dedupe: "", existing: [], now, quiet });
    expect(p.create[0].scheduledFor.toISOString()).toBe("2026-11-10T10:00:00.000Z");
    // 3 dage senere, grace 12 t: for gammel
    const stale = planNotifications({ rules: [later], recipients: [subject], anchor: now, dedupe: "", existing: [], now: new Date("2026-11-13T09:00:00Z"), quiet, pastGraceMs: 12 * 3_600_000 });
    expect(stale.create).toEqual([]);
    // 30 minutter for sent, grace 12 t: sendes straks
    const due = planNotifications({ rules: [later], recipients: [subject], anchor: now, dedupe: "", existing: [], now: new Date("2026-11-10T10:30:00Z"), quiet, pastGraceMs: 12 * 3_600_000 });
    expect(due.create[0].scheduledFor.toISOString()).toBe("2026-11-10T10:30:00.000Z");
  });
});

describe("addressFor", () => {
  it("bruger e-mail eller E.164-telefon", () => {
    expect(addressFor("EMAIL", { email: "a@b.dk", phone: null })).toBe("a@b.dk");
    expect(addressFor("SMS", { email: "a@b.dk", phone: "20 30 40 50" })).toBe("+4520304050");
    expect(addressFor("SMS", { email: "a@b.dk", phone: null })).toBeNull();
    expect(addressFor("SMS", { email: "a@b.dk", phone: "12" })).toBeNull();
  });
});
