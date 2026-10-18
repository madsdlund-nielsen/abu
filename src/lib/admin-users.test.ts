import { afterAll, describe, expect, it, vi } from "vitest";
import { asSystem, asUser, describeDb, uid, ownerDb } from "../test/db";
import { deactivationProblem } from "./admin-users";

vi.mock("next/headers", async () => (await import("../test/request")).nextHeadersMock);

describe("deaktivering af administratorer (regel)", () => {
  const target = { id: "b", role: "ADMIN" as const, deactivatedAt: null, name: "Bo" };
  it("man kan ikke deaktivere sig selv", () => {
    expect(deactivationProblem({ actorId: "b", target, actorActive: true, activeOthers: 3 })).toMatch(/dig selv/);
  });
  it("den sidste aktive administrator kan ikke deaktiveres", () => {
    expect(deactivationProblem({ actorId: "a", target, actorActive: true, activeOthers: 0 })).toMatch(/sidste aktive/);
    expect(deactivationProblem({ actorId: "a", target, actorActive: true, activeOthers: 1 })).toBeNull();
  });
  it("afviser deaktiverede aktører, ukendte mål og ikke-administratorer", () => {
    expect(deactivationProblem({ actorId: "a", target, actorActive: false, activeOthers: 2 })).toMatch(/ikke aktiv/);
    expect(deactivationProblem({ actorId: "a", target: null, actorActive: true, activeOthers: 2 })).toMatch(/findes ikke/);
    expect(deactivationProblem({ actorId: "a", target: { ...target, role: "ADVISOR" }, actorActive: true, activeOthers: 2 })).toMatch(/findes ikke/);
    expect(deactivationProblem({ actorId: "a", target: { ...target, deactivatedAt: new Date() }, actorActive: true, activeOthers: 2 })).toMatch(/allerede/);
  });
});

describeDb("administratorer mod databasen", () => {
  const ids: string[] = [];
  afterAll(async () => {
    const { prisma } = await import("./db");
    await (await ownerDb()).auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { entityId: { in: ids } }] } });
    await asSystem(() => prisma.user.deleteMany({ where: { id: { in: ids } } }));
  });
  // Handlingerne udføres af den indloggede administrator (actions/admin-users.ts); testdata i systemkontekst
  const as = <T>(u: { id: string }, fn: () => Promise<T>) => asUser({ id: u.id, role: "ADMIN" }, fn);

  async function admin(opts: { password?: boolean; mfa?: boolean } = {}) {
    const { prisma } = await import("./db");
    const u = await asSystem(() => prisma.user.create({
      data: { email: `${uid("adm")}@test.dk`, name: `Admin ${uid()}`, role: "ADMIN", passwordHash: opts.password === false ? null : "x", mfaEnabledAt: opts.mfa ? new Date() : null, mfaSecretEnc: opts.mfa ? "v1.a.b.c.d" : null },
    }));
    ids.push(u.id);
    return u;
  }

  it("to administratorer, der deaktiverer hinanden samtidig: kun den ene lykkes (aldrig nul aktive)", async () => {
    const { prisma } = await import("./db");
    const { deactivateAdmin } = await import("./admin-users");
    const a = await admin();
    const b = await admin();
    const [r1, r2] = await Promise.all([as(a, () => deactivateAdmin(a.id, b.id)), as(b, () => deactivateAdmin(b.id, a.id))]);
    expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
    const failed = r1.ok ? r2 : r1;
    expect(!failed.ok && failed.error).toMatch(/ikke aktiv/);
    const active = await asSystem(() => prisma.user.count({ where: { id: { in: [a.id, b.id] }, deactivatedAt: null } }));
    expect(active).toBe(1);
  });

  it("kan ikke deaktivere sig selv; deaktivering logger ud, fjerner enheder og ugyldiggør links", async () => {
    const { prisma } = await import("./db");
    const { deactivateAdmin } = await import("./admin-users");
    const { createTrustedDevice } = await import("./mfa/service");
    const a = await admin();
    const b = await admin();
    await as(a, async () => {
      expect(await deactivateAdmin(a.id, a.id)).toMatchObject({ ok: false, error: expect.stringMatching(/dig selv/) });
      await asSystem(async () => {
        await prisma.session.create({ data: { id: uid("s"), userId: b.id, expiresAt: new Date(Date.now() + 3_600_000) } });
        await prisma.passwordToken.create({ data: { userId: b.id, tokenHash: uid("tok"), purpose: "RESET", expiresAt: new Date(Date.now() + 3_600_000) } });
      });
      await createTrustedDevice(b.id, { userAgent: null, ip: null }, 30);
      expect(await deactivateAdmin(a.id, b.id)).toMatchObject({ ok: true });
      expect(await prisma.session.count({ where: { userId: b.id } })).toBe(0);
      expect(await prisma.trustedDevice.count({ where: { userId: b.id } })).toBe(0);
      expect(await prisma.passwordToken.count({ where: { userId: b.id, usedAt: null } })).toBe(0);
      const actions = (await prisma.auditLog.findMany({ where: { entityId: b.id } })).map((x) => x.action);
      expect(actions).toEqual(expect.arrayContaining(["admin.deactivate", "auth.devices_revoked"]));
      expect(await deactivateAdmin(a.id, b.id)).toMatchObject({ ok: false, error: expect.stringMatching(/allerede deaktiveret/) });
    });
  });

  it("invitation: ny admin uden adgangskode og gyldigt link; ny invitation ugyldiggør det gamle; genaktivering af deaktiveret", async () => {
    const { prisma } = await import("./db");
    const { findValidPasswordToken } = await import("./auth");
    const { inviteAdmin, resendAdminInvite } = await import("./admin-users");
    const actor = await admin({ mfa: true });
    const email = `${uid("inv")}@test.dk`;
    await as(actor, async () => {
      expect(await inviteAdmin(actor.id, { name: "A", email })).toMatchObject({ ok: false, error: expect.stringMatching(/navn/) });
      expect(await inviteAdmin(actor.id, { name: "Ny Admin", email: "ikke-en-mail" })).toMatchObject({ ok: false });
      const r = await inviteAdmin(actor.id, { name: "Ny Admin", email });
      expect(r).toMatchObject({ ok: true, sent: true, reactivated: false });
      const created = await prisma.user.findUniqueOrThrow({ where: { email } });
      ids.push(created.id);
      expect(created).toMatchObject({ role: "ADMIN", passwordHash: null });
      expect(await prisma.passwordToken.count({ where: { userId: created.id, usedAt: null, purpose: "INVITE" } })).toBe(1);
      expect(await resendAdminInvite(actor.id, created.id)).toMatchObject({ ok: true });
      expect(await prisma.passwordToken.count({ where: { userId: created.id, usedAt: null } })).toBe(1);
      // En rådgiver/kunde-e-mail kan ikke blive admin
      const adv = await asSystem(() => prisma.user.create({ data: { email: `${uid("adv")}@test.dk`, name: "R", role: "ADVISOR" } }));
      ids.push(adv.id);
      expect(await inviteAdmin(actor.id, { name: "R R", email: adv.email })).toMatchObject({ ok: false, error: expect.stringMatching(/rådgiver eller kunde/) });
      // Deaktiveret admin inviteres igen: adgangskode og MFA nulstilles
      await prisma.user.update({ where: { id: created.id }, data: { passwordHash: "x", mfaEnabledAt: new Date(), mfaSecretEnc: "v1.a.b.c.d", deactivatedAt: new Date() } });
      expect(await resendAdminInvite(actor.id, created.id)).toMatchObject({ ok: false, error: expect.stringMatching(/deaktiveret/) });
      const again = await inviteAdmin(actor.id, { name: "Ny Admin", email });
      expect(again).toMatchObject({ ok: true, reactivated: true });
      expect(await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ deactivatedAt: null, passwordHash: null, mfaEnabledAt: null, mfaSecretEnc: null });
      // Et link til en deaktiveret konto virker ikke
      await prisma.user.update({ where: { id: created.id }, data: { deactivatedAt: new Date() } });
      const tok = await prisma.passwordToken.findFirstOrThrow({ where: { userId: created.id, usedAt: null } });
      expect(tok).toBeTruthy();
      const { displayInviteLink } = await import("./admin-users");
      const link = await displayInviteLink(created.id);
      expect(await findValidPasswordToken(new URL(link).searchParams.get("token")!)).toBeNull();
    });
  });

  it("nulstil en anden administrators MFA: hemmelighed, koder, enheder og sessioner fjernes – ikke ens egen", async () => {
    const { prisma } = await import("./db");
    const { resetAdminMfa, revokeAdminDevices } = await import("./admin-users");
    const { createTrustedDevice } = await import("./mfa/service");
    const a = await admin({ mfa: true });
    const b = await admin({ mfa: true });
    await as(a, async () => {
      expect(await resetAdminMfa(a.id, a.id)).toMatchObject({ ok: false });
      await asSystem(async () => {
        await prisma.mfaRecoveryCode.create({ data: { userId: b.id, codeHash: uid("h") } });
        await prisma.session.create({ data: { id: uid("s"), userId: b.id, expiresAt: new Date(Date.now() + 3_600_000) } });
      });
      await createTrustedDevice(b.id, { userAgent: null, ip: null }, 30);
      expect(await revokeAdminDevices(a.id, b.id)).toMatchObject({ ok: true, message: expect.stringMatching(/1 betroede enhed/) });
      await createTrustedDevice(b.id, { userAgent: null, ip: null }, 30);
      expect(await resetAdminMfa(a.id, b.id)).toMatchObject({ ok: true });
      const row = await prisma.user.findUniqueOrThrow({ where: { id: b.id } });
      expect(row).toMatchObject({ mfaEnabledAt: null, mfaSecretEnc: null });
      // Gendannelseskoderne er kun synlige i systemkontekst – heller ikke for en administrator
      expect(await prisma.mfaRecoveryCode.count({ where: { userId: b.id } })).toBe(0);
      expect(await asSystem(() => prisma.mfaRecoveryCode.count({ where: { userId: b.id } }))).toBe(0);
      expect(await prisma.trustedDevice.count({ where: { userId: b.id } })).toBe(0);
      expect(await prisma.session.count({ where: { userId: b.id } })).toBe(0);
      expect((await prisma.auditLog.findMany({ where: { entityId: b.id } })).map((x) => x.action)).toContain("admin.mfa_reset");
    });
  });
});
