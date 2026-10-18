import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asSystem, asUser, createTestUser, deleteTestUsers, describeDb, uid } from "../test/db";

describe("sletning (M-3)", () => {
  it("modulet eksporterer sletning og oprydning", async () => {
    const m = await import("./erasure");
    expect(m.WEBHOOK_PAYLOAD_RETENTION_DAYS).toBe(30);
  });
});

describeDb("sletning mod databasen (M-3)", () => {
  // Sletningen udføres af en administrator (processDeletionAction, frisk kode); WebhookEvent m.m. i systemkontekst
  let admin: { id: string; role: "ADMIN" };
  beforeAll(async () => {
    admin = { id: (await createTestUser("ADMIN")).id, role: "ADMIN" };
  });
  afterAll(() => deleteTestUsers([admin.id]));
  const asAdmin = <T>(fn: () => Promise<T>) => asUser(admin, fn);

  async function seedCustomer() {
    return asSystem(() => seedCustomerAsSystem());
  }
  async function seedCustomerAsSystem() {
    const { prisma } = await import("./db");
    const email = `${uid("slet")}@test.dk`;
    const u = await prisma.user.create({
      data: { email, name: "Slet Mig", role: "CUSTOMER", deletionRequestedAt: new Date(), customerProfile: { create: { companyName: "X", cvr: "1", billingEmail: email } } },
    });
    const sub = await prisma.subscription.create({
      data: { customerId: u.id, advisorCount: 2, frequencyWeeks: 8, monthlyPriceDkk: 1, status: "ACTIVE", provider: "frisbii", providerSubscriptionId: `fsub-${u.id}`, providerCustomerId: `fcus-${u.id}` },
    });
    const m = await prisma.meeting.create({
      data: { subscriptionId: sub.id, startsAt: new Date(), endsAt: new Date(), providerMeetingId: `wb-${u.id}`, recordings: { create: [{ source: "UPLOAD", storageKey: `recordings/x/${u.id}`, status: "DONE" }] } },
    });
    await prisma.webhookEvent.createMany({
      data: [
        { provider: "frisbii", externalId: uid("evt"), payload: { id: "e1", subscription: `fsub-${u.id}`, customer: `fcus-${u.id}`, email } },
        { provider: "whereby", externalId: `video:wb-${u.id}:rec.mp4`, payload: { type: "recording.finished" } },
        { provider: "frisbii", externalId: uid("andet"), payload: { id: "e2", subscription: "en-anden" } },
      ],
    });
    await prisma.lead.create({ data: { email, name: "Slet Mig" } });
    return { prisma, u, sub, m, email };
  }

  it("opsiger hos udbyderen, sletter optagelser i lageret og webhook-payloads, og derefter kontoen", async () => {
    const { prisma, u, email } = await seedCustomer();
    const { eraseUser } = await import("./erasure");
    const cancelSubscription = vi.fn().mockResolvedValue(undefined);
    const del = vi.fn().mockResolvedValue(undefined);
    const r = await asAdmin(() => eraseUser(u.id, admin.id, { payments: { cancelSubscription }, storage: { delete: del } }));
    expect(r).toMatchObject({ ok: true, cancelled: 1, objects: 1, webhookEvents: 2 });
    expect(cancelSubscription).toHaveBeenCalledWith(`fsub-${u.id}`);
    expect(del).toHaveBeenCalledWith(`recordings/x/${u.id}`);
    await asSystem(async () => {
      expect(await prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
      expect(await prisma.lead.findUnique({ where: { email } })).toBeNull();
      const left = await prisma.webhookEvent.findMany({ where: { OR: [{ payload: { path: ["subscription"], equals: `fsub-${u.id}` } }, { externalId: { startsWith: `video:wb-${u.id}` } }] } });
      expect(left).toHaveLength(0);
      expect(await prisma.webhookEvent.count({ where: { payload: { path: ["subscription"], equals: "en-anden" } } })).toBeGreaterThan(0);
      // Sletningen er audit-logget med administratoren som aktør
      expect(await prisma.auditLog.count({ where: { action: "user.delete", entityId: u.id, userId: admin.id } })).toBe(1);
    });
  });

  it("sletter intet, hvis opsigelsen hos udbyderen fejler", async () => {
    const { prisma, u } = await seedCustomer();
    const { eraseUser } = await import("./erasure");
    const r = await asAdmin(() => eraseUser(u.id, admin.id, { payments: { cancelSubscription: vi.fn().mockRejectedValue(new Error("503")) }, storage: { delete: vi.fn() } }));
    expect(r.ok).toBe(false);
    await asSystem(async () => {
      expect(await prisma.user.findUnique({ where: { id: u.id } })).not.toBeNull();
      await prisma.webhookEvent.deleteMany({ where: { payload: { path: ["subscription"], equals: `fsub-${u.id}` } } });
      await prisma.user.delete({ where: { id: u.id } });
    });
  });

  it("sletning af en rådgiver sletter profilbilledet (512 og 96 px) i lageret", async () => {
    const { prisma } = await import("./db");
    const { eraseUser } = await import("./erasure");
    const u = await asSystem(async () => {
      const u = await prisma.user.create({
        data: { email: `${uid("slet-adv")}@test.dk`, name: "Rådgiver Slet", role: "ADVISOR", advisorProfile: { create: { photoKey: "avatars/x/abc.webp", photoUpdatedAt: new Date() } } },
      });
      await prisma.advisorProfile.update({ where: { userId: u.id }, data: { photoKey: `avatars/${u.id}/abc.webp` } });
      return u;
    });
    const del = vi.fn().mockResolvedValue(undefined);
    const r = await asAdmin(() => eraseUser(u.id, admin.id, { payments: { cancelSubscription: vi.fn() }, storage: { delete: del } }));
    expect(r).toMatchObject({ ok: true, objects: 2 });
    expect(del.mock.calls.map((c) => c[0]).sort()).toEqual([`avatars/${u.id}/abc-96.webp`, `avatars/${u.id}/abc.webp`]);
    await asSystem(async () => {
      expect(await prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
      expect(await prisma.advisorProfile.findUnique({ where: { userId: u.id } })).toBeNull();
    });
  });

  it("sletter ikke rådgiveren, hvis profilbilledet ikke kan slettes i lageret", async () => {
    const { prisma } = await import("./db");
    const { eraseUser } = await import("./erasure");
    const u = await asSystem(async () => {
      const u = await prisma.user.create({ data: { email: `${uid("slet-adv")}@test.dk`, name: "R", role: "ADVISOR", advisorProfile: { create: {} } } });
      await prisma.advisorProfile.update({ where: { userId: u.id }, data: { photoKey: `avatars/${u.id}/abc.webp`, photoUpdatedAt: new Date() } });
      return u;
    });
    const r = await asAdmin(() => eraseUser(u.id, admin.id, { payments: { cancelSubscription: vi.fn() }, storage: { delete: vi.fn().mockRejectedValue(new Error("503")) } }));
    expect(r).toEqual({ ok: false, error: "Profilbilledet kunne ikke slettes fra lageret. Prøv igen." });
    await asSystem(async () => {
      expect(await prisma.user.findUnique({ where: { id: u.id } })).not.toBeNull();
      await prisma.user.delete({ where: { id: u.id } });
    });
  });

  // Jobkøen kører i systemkontekst («jobs.process»)
  it("fjerner webhook-payloads efter 30 dage, men beholder id'et (idempotens)", () => asSystem(async () => {
    const { prisma } = await import("./db");
    const { cleanupWebhookPayloads } = await import("./erasure");
    const old = uid("gammel");
    await prisma.webhookEvent.create({ data: { provider: "frisbii", externalId: old, payload: { email: "kunde@firma.dk" }, createdAt: new Date(Date.now() - 31 * 86_400_000) } });
    const fresh = uid("ny");
    await prisma.webhookEvent.create({ data: { provider: "frisbii", externalId: fresh, payload: { email: "kunde@firma.dk" } } });
    await cleanupWebhookPayloads();
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { externalId: old } })).payload).toEqual({ fjernet: true });
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { externalId: fresh } })).payload).toEqual({ email: "kunde@firma.dk" });
    await prisma.webhookEvent.deleteMany({ where: { externalId: { in: [old, fresh] } } });
  }));
});
