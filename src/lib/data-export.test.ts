import { describe, expect, it } from "vitest";
import { asSystem, asUser, describeDb, uid } from "../test/db";
import { EXPORT_MEETING_SELECT, EXPORT_USER_SELECT } from "./data-export";

describe("dataeksport vælger kun tilladte felter (M-2)", () => {
  it("udelader værtslink, mødelinks, udbyder-id'er, hash og spærring", () => {
    const meetingKeys = Object.keys(EXPORT_MEETING_SELECT);
    for (const k of ["hostRoomUrl", "roomUrl", "providerMeetingId", "recordings", "createdById"]) expect(meetingKeys).not.toContain(k);
    const userKeys = Object.keys(EXPORT_USER_SELECT);
    for (const k of ["passwordHash", "sessions", "passwordTokens", "failedLoginCount", "lockedUntil", "mfaSecretEnc", "mfaPendingSecretEnc", "mfaKeyId", "mfaLastUsedStep", "recoveryCodes"]) expect(userKeys).not.toContain(k);
    expect(Object.keys(EXPORT_USER_SELECT.trustedDevices.select)).not.toContain("tokenHash");
    const subKeys = Object.keys(EXPORT_USER_SELECT.customerProfile.select.subscriptions.select);
    expect(subKeys).not.toContain("providerSubscriptionId");
    expect(subKeys).not.toContain("providerCustomerId");
  });
});

describeDb("dataeksport mod databasen (M-2)", () => {
  it("indeholder ikke værtens mødelink, selv om kunden deltager i mødet", async () => {
    const { prisma } = await import("./db");
    const { buildDataExport } = await import("./data-export");
    const email = `${uid("exp")}@test.dk`;
    const { u, advisor } = await asSystem(async () => {
      const u = await prisma.user.create({
        data: { email, name: "Eks Port", role: "CUSTOMER", passwordHash: "hemmelig-hash", customerProfile: { create: { companyName: "X", cvr: "1", billingEmail: email } } },
      });
      const advisor = await prisma.user.create({ data: { email: `${uid("exp-r")}@test.dk`, name: "Rådgiver Navn", phone: "+4511223344", role: "ADVISOR", advisorProfile: { create: {} } } });
      const sub = await prisma.subscription.create({
        data: { customerId: u.id, advisorCount: 2, frequencyWeeks: 8, monthlyPriceDkk: 1, providerSubscriptionId: "frisbii-sub-1", advisors: { create: [{ advisorId: advisor.id }] } },
      });
      await prisma.meeting.create({
        data: {
          subscriptionId: sub.id,
          startsAt: new Date(),
          endsAt: new Date(),
          roomUrl: "https://abu.whereby.com/kunde-rum",
          hostRoomUrl: "https://abu.whereby.com/vaert-rum?roomKey=HEMMELIG",
          providerMeetingId: "wb-123",
          participants: { create: [{ userId: u.id }, { userId: advisor.id }] },
        },
      });
      return { u, advisor };
    });
    // Eksporten hentes af kunden selv (api/account/export)
    const exp = await asUser(u, () => buildDataExport(u));
    const json = JSON.stringify(exp);
    expect(json).toContain(email);
    expect(json).not.toContain("HEMMELIG");
    expect(json).not.toContain("hostRoomUrl");
    expect(json).not.toContain("wb-123");
    expect(json).not.toContain("frisbii-sub-1");
    expect(json).not.toContain("hemmelig-hash");
    // Rådgiverens navn er med (board og møde), men ikke rådgiverens kontaktoplysninger
    expect(exp.meetings[0].participants.map((p) => p.user.name)).toContain("Rådgiver Navn");
    expect(exp.user.customerProfile?.subscriptions[0].advisors[0].advisor.user.name).toBe("Rådgiver Navn");
    expect(json).not.toContain("+4511223344");
    await asSystem(() => prisma.user.deleteMany({ where: { id: { in: [u.id, advisor.id] } } }));
  });
});

describeDb("dataeksport: profilbilledet som metadata", () => {
  it("rådgiverens eksport har lagernøgler, tidspunkt og en note om, hvordan billedet fås", async () => {
    const { prisma } = await import("./db");
    const { buildDataExport } = await import("./data-export");
    const at = new Date("2026-10-18T09:00:00Z");
    const u = await asSystem(() => prisma.user.create({ data: { email: `${uid("exp-adv")}@test.dk`, name: "R", role: "ADVISOR", advisorProfile: { create: {} } } }));
    await asSystem(() => prisma.advisorProfile.update({ where: { userId: u.id }, data: { photoKey: `avatars/${u.id}/abc.webp`, photoUpdatedAt: at } }));
    const exp = await asUser(u, () => buildDataExport(u));
    expect(exp.profilePhoto).toMatchObject({ storageKeys: [`avatars/${u.id}/abc.webp`, `avatars/${u.id}/abc-96.webp`], updatedAt: at });
    expect(exp.profilePhoto?.note).toContain(`/api/avatar/${u.id}?size=512`);
    expect(exp.profilePhoto?.note).toMatch(/skriv til os/);
    await asSystem(() => prisma.advisorProfile.update({ where: { userId: u.id }, data: { photoKey: null, photoUpdatedAt: null } }));
    expect((await asUser(u, () => buildDataExport(u))).profilePhoto).toBeNull();
    await asSystem(() => prisma.user.delete({ where: { id: u.id } }));
  });
});
