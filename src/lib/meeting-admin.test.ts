import { afterAll, describe, expect, it } from "vitest";
import { describeDb, uid } from "../test/db";
import { hasWholeBoard } from "./booking";
import { canRemoveWithoutReplacement, meetingAdvisorChangeError, WHOLE_BOARD_ERROR } from "./meeting-admin";

describe("møder holdes altid med hele boardet (ejerens beslutning)", () => {
  it("en ren fjernelse under boardets størrelse afvises", () => {
    expect(meetingAdvisorChangeError({ current: 3, boardSize: 3, remove: true, add: false })).toBe(WHOLE_BOARD_ERROR);
    expect(meetingAdvisorChangeError({ current: 2, boardSize: 2, remove: true, add: false })).toBe(WHOLE_BOARD_ERROR);
    // Allerede under boardet (fx efter en sletning): heller ikke længere ned
    expect(meetingAdvisorChangeError({ current: 1, boardSize: 2, remove: true, add: false })).toBe(WHOLE_BOARD_ERROR);
    expect(WHOLE_BOARD_ERROR).toBe("Et møde holdes altid med hele boardet – udskift rådgiveren i stedet.");
  });

  it("udskiftning er altid tilladt, og en ekstra deltager må tilføjes og fjernes igen", () => {
    expect(meetingAdvisorChangeError({ current: 3, boardSize: 3, remove: true, add: true })).toBeNull();
    expect(meetingAdvisorChangeError({ current: 3, boardSize: 3, remove: false, add: true })).toBeNull();
    expect(meetingAdvisorChangeError({ current: 4, boardSize: 3, remove: true, add: false })).toBeNull();
    expect(meetingAdvisorChangeError({ current: 1, boardSize: 2, remove: false, add: true })).toBeNull();
    expect(meetingAdvisorChangeError({ current: 3, boardSize: 3, remove: false, add: false })).toMatch(/Vælg/);
    expect(canRemoveWithoutReplacement(3, 3)).toBe(false);
    expect(canRemoveWithoutReplacement(4, 3)).toBe(true);
  });

  it("booking kræver, at alle boardets pladser er besat", () => {
    expect(hasWholeBoard({ advisorCount: 3, advisors: [1, 2, 3] })).toBe(true);
    expect(hasWholeBoard({ advisorCount: 3, advisors: [1, 2] })).toBe(false);
    expect(hasWholeBoard({ advisorCount: 0, advisors: [] })).toBe(false);
  });
});

describeDb("hele boardet i databasen: fjern, udskift, board-ændring og sletning", () => {
  const ids: string[] = [];
  const tagless = async (name: string, available = true) => {
    const { prisma } = await import("./db");
    const u = await prisma.user.create({
      data: { email: `${uid("adv")}@test.dk`, name, role: "ADVISOR", passwordHash: "x", advisorProfile: { create: { active: true, bio: "x" } } },
    });
    ids.push(u.id);
    // Mandag 08-17 (København)
    if (available) await prisma.availabilityRule.create({ data: { advisorId: u.id, weekday: 1, startMinute: 480, endMinute: 1020 } });
    return u.id;
  };
  // Mandag 7. januar 2030 kl. 10:00 København (09:00 UTC)
  const startsAt = new Date("2030-01-07T09:00:00Z");
  const endsAt = new Date("2030-01-07T11:00:00Z");

  async function boardWithMeeting(advisorIds: string[]) {
    const { prisma } = await import("./db");
    const email = `${uid("kunde")}@test.dk`;
    const c = await prisma.user.create({ data: { email, name: "Kunde", role: "CUSTOMER", customerProfile: { create: { companyName: uid("Firma"), cvr: "1", billingEmail: email } } } });
    ids.push(c.id);
    const sub = await prisma.subscription.create({
      data: {
        customerId: c.id,
        advisorCount: advisorIds.length,
        frequencyWeeks: 8,
        monthlyPriceDkk: 1,
        status: "ACTIVE",
        provider: "mock",
        startedAt: new Date(),
        advisors: { create: advisorIds.map((advisorId) => ({ advisorId })) },
      },
    });
    const meeting = await prisma.meeting.create({
      data: { subscriptionId: sub.id, startsAt, endsAt, participants: { create: [{ userId: c.id }, ...advisorIds.map((userId) => ({ userId }))] } },
    });
    return { sub, meeting, customerId: c.id };
  }

  const advisorsIn = async (meetingId: string) => {
    const { prisma } = await import("./db");
    const ps = await prisma.meetingParticipant.findMany({ where: { meetingId, user: { role: "ADVISOR" } }, select: { userId: true } });
    return ps.map((p) => p.userId).sort();
  };

  afterAll(async () => {
    const { prisma } = await import("./db");
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("admin kan ikke reducere et møde, men kan udskifte og tilføje/fjerne en ekstra deltager", async () => {
    const { changeMeetingAdvisors } = await import("./meeting-admin");
    const [a, b, x, y] = [await tagless("A"), await tagless("B"), await tagless("X"), await tagless("Y")];
    const { meeting, customerId } = await boardWithMeeting([a, b]);
    ids.push(customerId);
    const base = { meetingId: meeting.id, actorId: customerId, silent: true };

    await expect(changeMeetingAdvisors({ ...base, removeId: a })).rejects.toThrow(WHOLE_BOARD_ERROR);
    expect(await advisorsIn(meeting.id)).toEqual([a, b].sort());

    // Udskiftning: stadig to rådgivere
    await changeMeetingAdvisors({ ...base, removeId: a, addId: x });
    expect(await advisorsIn(meeting.id)).toEqual([b, x].sort());

    // Ekstra deltager ud over boardet kan tilføjes og fjernes igen – men ikke længere ned
    await changeMeetingAdvisors({ ...base, addId: y });
    expect((await advisorsIn(meeting.id)).length).toBe(3);
    await changeMeetingAdvisors({ ...base, removeId: y });
    await expect(changeMeetingAdvisors({ ...base, removeId: b })).rejects.toThrow(WHOLE_BOARD_ERROR);
    expect(await advisorsIn(meeting.id)).toEqual([b, x].sort());
  });

  it("board-ændring med «opdatér kommende møder»: er den nye rådgiver optaget, bliver den gamle i mødet (intet hul)", async () => {
    const { changeBoardAsAdmin } = await import("./board-admin");
    const [a, b, busy] = [await tagless("A"), await tagless("B"), await tagless("Optaget", false)];
    const { sub, meeting, customerId } = await boardWithMeeting([a, b]);
    const r = await changeBoardAsAdmin({ subscriptionId: sub.id, advisorIds: [a, busy], weeks: 8, pricePolicy: "keep", updateUpcoming: true, actorId: customerId });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.conflicts.length).toBe(1);
    expect(await advisorsIn(meeting.id)).toEqual([a, b].sort());
  });

  it("GDPR-sletning af en rådgiver: berørte møder audit-logges, admin får en alarm og en advarselsliste", async () => {
    const { prisma } = await import("./db");
    const { eraseUser } = await import("./erasure");
    const { meetingsBelowBoard } = await import("./meeting-admin");
    const [a, b] = [await tagless("A"), await tagless("Slettes")];
    const { meeting, customerId } = await boardWithMeeting([a, b]);
    const r = await eraseUser(b, customerId, { payments: { cancelSubscription: async () => {} }, storage: { delete: async () => {} } });
    expect(r.ok).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "meeting.advisor_erased", entityId: meeting.id } })).toBe(1);
    const alert = await prisma.appSetting.findUnique({ where: { key: "alert:advisor_erased" } });
    expect(alert?.value).toMatch(/kommende møde mangler nu en rådgiver/);
    expect(alert?.value).not.toMatch(/Slettes/);
    const below = await meetingsBelowBoard(new Date("2029-12-01T00:00:00Z"));
    expect(below.find((m) => m.id === meeting.id)).toMatchObject({ advisors: 1, boardSize: 2 });
    await prisma.auditLog.deleteMany({ where: { entityId: meeting.id } });
  });
});
