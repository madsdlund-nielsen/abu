import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeDb, uid, ownerDb } from "../../test/db";
import { cookieJar, formData, redirectOf } from "../../test/request";

// Server actions kaldes direkte med en rigtig session i cookie-krukken (ingen mock af requireRole): det er selve
// session-kontrollen, der testes.
vi.mock("next/headers", async () => (await import("../../test/request")).nextHeadersMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));

describe("sessionens trin og re-verifikation (rene funktioner)", () => {
  it("adgangskode godkendt, kode mangler ≠ fuldt logget ind", async () => {
    const { sessionStage } = await import("@/lib/auth");
    const on = new Date();
    expect(sessionStage({ mfaPending: true }, { role: "ADVISOR", mfaEnabledAt: on, deactivatedAt: null })).toBe("mfa_verify");
    expect(sessionStage({ mfaPending: true }, { role: "ADMIN", mfaEnabledAt: null, deactivatedAt: null })).toBe("mfa_setup");
    // Admin uden MFA er aldrig fuldt logget ind – heller ikke med en ældre session
    expect(sessionStage({ mfaPending: false }, { role: "ADMIN", mfaEnabledAt: null, deactivatedAt: null })).toBe("mfa_setup");
    expect(sessionStage({ mfaPending: false }, { role: "ADMIN", mfaEnabledAt: on, deactivatedAt: null })).toBe("full");
    expect(sessionStage({ mfaPending: false }, { role: "CUSTOMER", mfaEnabledAt: null, deactivatedAt: null })).toBe("full");
    // Ugyldige: deaktiveret, eller MFA slået fra mens sessionen ventede
    expect(sessionStage({ mfaPending: false }, { role: "ADMIN", mfaEnabledAt: on, deactivatedAt: on })).toBeNull();
    expect(sessionStage({ mfaPending: true }, { role: "CUSTOMER", mfaEnabledAt: null, deactivatedAt: null })).toBeNull();
  });

  it("re-verifikation gælder i 15 minutter", async () => {
    const { isMfaFresh } = await import("@/lib/auth");
    const now = new Date("2026-10-19T10:00:00Z");
    const ago = (min: number) => ({ mfaVerifiedAt: new Date(now.getTime() - min * 60_000) });
    expect(isMfaFresh(ago(0), now)).toBe(true);
    expect(isMfaFresh(ago(14.9), now)).toBe(true);
    expect(isMfaFresh(ago(15), now)).toBe(true);
    expect(isMfaFresh(ago(15.1), now)).toBe(false);
    expect(isMfaFresh({ mfaVerifiedAt: null }, now)).toBe(false);
    // Et tidsstempel i fremtiden (uret) tæller ikke
    expect(isMfaFresh(ago(-5), now)).toBe(false);
  });
});

describeDb("MFA i server actions og sessioner", () => {
  const ids: string[] = [];
  beforeEach(() => cookieJar.clear());
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await (await ownerDb()).auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "inv-", endsWith: "@test.dk" } } });
  });

  async function user(role: "ADMIN" | "ADVISOR" | "CUSTOMER", opts: { mfa?: boolean } = {}) {
    const { prisma } = await import("@/lib/db");
    const { sealSecret } = await import("@/lib/mfa/service");
    const { generateTotpSecret } = await import("@/lib/mfa/totp");
    const { hashPassword } = await import("@/lib/auth");
    const u = await prisma.user.create({
      data: { email: `${uid(role.toLowerCase())}@test.dk`, name: `${role} Test`, role, passwordHash: await hashPassword("Rigtig-Adgangskode-1"), recordingConsentAt: new Date() },
    });
    ids.push(u.id);
    if (!opts.mfa) return { user: u, secret: "" };
    const secret = generateTotpSecret();
    const sealed = sealSecret(u.id, secret);
    const updated = await prisma.user.update({ where: { id: u.id }, data: { mfaEnabledAt: new Date(), mfaSecretEnc: sealed.enc, mfaKeyId: sealed.keyId } });
    return { user: updated, secret };
  }

  /** Logger ind i cookie-krukken med en session på det ønskede trin. */
  async function signIn(userId: string, opts: { pending?: boolean; verifiedMinutesAgo?: number | null } = {}) {
    const { createSession } = await import("@/lib/auth");
    await createSession(userId, {
      mfaPending: opts.pending,
      mfaVerifiedAt: opts.verifiedMinutesAgo == null ? null : new Date(Date.now() - opts.verifiedMinutesAgo * 60_000),
    });
    return cookieJar.get("abu_session")!;
  }

  it("en MFA-ventende admin-session kan ikke køre admin-handlinger (omdirigeres til MFA, intet ændres)", async () => {
    const { prisma } = await import("@/lib/db");
    const admin = await user("ADMIN"); // uden MFA → skal opsætte
    await signIn(admin.user.id, { pending: true });
    const email = `inv-${uid()}@test.dk`;
    const { inviteAdminAction, deactivateAdminAction, resetAdminMfaAction, saveTrustedDeviceDaysAction } = await import("./admin-users");
    const { createAdvisorAction, processDeletionAction, setAdvisorActiveAction } = await import("./admin");
    const { saveSettingsAction } = await import("./notifications");
    const { applyBalancingAction } = await import("./admin-meetings");
    const victim = await user("ADMIN", { mfa: true });
    const attempts: [string, () => Promise<unknown>][] = [
      ["inviteAdmin", () => inviteAdminAction({}, formData({ name: "Ny Admin", email }))],
      ["deactivateAdmin", () => deactivateAdminAction(formData({ userId: victim.user.id }))],
      ["resetAdminMfa", () => resetAdminMfaAction(formData({ userId: victim.user.id }))],
      ["trustedDays", () => saveTrustedDeviceDaysAction(formData({ days: "1" }))],
      ["createAdvisor", () => createAdvisorAction({}, formData({ name: "Ny Rådgiver", email: `inv-${uid()}@test.dk`, title: "" }))],
      ["processDeletion", () => processDeletionAction(formData({ userId: victim.user.id }))],
      ["setAdvisorActive", () => setAdvisorActiveAction({}, formData({ userId: victim.user.id, active: "false" }))],
      ["applyBalancing", () => applyBalancingAction(formData({ move: "a:b:c" }))],
      ["notificationSettings", () => saveSettingsAction({ quietEnabled: false, quietStart: 21, quietEnd: 8, smsSender: "ABU", logRetentionMonths: 12, leadRetentionMonths: 24, smsCountries: ["45"], smsPerNumberCap: 5, smsDailyCap: 100 })],
    ];
    for (const [name, run] of attempts) expect(await redirectOf(run), name).toBe("/mfa/opsaet");
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: victim.user.id } })).deactivatedAt).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: victim.user.id } })).mfaEnabledAt).not.toBeNull();

    // Samme for en admin med MFA, der kun har givet adgangskoden: → /mfa
    const admin2 = await user("ADMIN", { mfa: true });
    cookieJar.clear();
    await signIn(admin2.user.id, { pending: true });
    expect(await redirectOf(() => deactivateAdminAction(formData({ userId: victim.user.id })))).toBe("/mfa");
    const { getCurrentUser } = await import("@/lib/auth");
    expect(await getCurrentUser()).toBeNull();
  }, 20_000); // importerer fire store action-moduler og hasher tre adgangskoder (bcrypt 12) – over 5 s under fuld parallel testkørsel

  it("følsomme handlinger kræver en kode inden for 15 minutter (ellers /mfa/bekraeft eller en fejl med link)", async () => {
    const { REVERIFY_MESSAGE } = await import("@/lib/auth");
    const admin = await user("ADMIN", { mfa: true });
    await signIn(admin.user.id, { verifiedMinutesAgo: 20 });
    const { inviteAdminAction } = await import("./admin-users");
    const { processDeletionAction } = await import("./admin");
    const { saveSettingsAction } = await import("./notifications");
    expect(await redirectOf(() => inviteAdminAction({}, formData({ name: "X Y", email: `inv-${uid()}@test.dk` })))).toBe("/mfa/bekraeft?next=%2Fadmin%2Fadministratorer");
    expect(await redirectOf(() => processDeletionAction(formData({ userId: "x" })))).toBe("/mfa/bekraeft?next=%2Fadmin%2Fcustomers");
    expect(await saveSettingsAction({ quietEnabled: false, quietStart: 21, quietEnd: 8, smsSender: "ABU", logRetentionMonths: 12, leadRetentionMonths: 24, smsCountries: ["45"], smsPerNumberCap: 5, smsDailyCap: 100 })).toEqual({ ok: false, error: REVERIFY_MESSAGE });
    // Trusted-device-login (ingen kode i denne session) er heller ikke frisk
    cookieJar.clear();
    await signIn(admin.user.id, { verifiedMinutesAgo: null });
    expect(await redirectOf(() => inviteAdminAction({}, formData({ name: "X Y", email: `inv-${uid()}@test.dk` })))).toMatch(/^\/mfa\/bekraeft/);
  });

  it("invitation af administrator: ADMIN uden adgangskode, mail via notifikationerne og link vist i konsol-tilstand", async () => {
    const { prisma } = await import("@/lib/db");
    const admin = await user("ADMIN", { mfa: true });
    await signIn(admin.user.id, { verifiedMinutesAgo: 1 });
    const { inviteAdminAction } = await import("./admin-users");
    const email = `inv-${uid()}@test.dk`;
    const state = await inviteAdminAction({}, formData({ name: "Ny Administrator", email }));
    expect(state.error).toBeUndefined();
    expect(state.ok).toMatch(/inviteret som administrator/);
    expect(state.inviteLink).toMatch(/\/set-password\?token=/);
    const created = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(created).toMatchObject({ role: "ADMIN", passwordHash: null, mfaEnabledAt: null });
    const log = await prisma.notificationLog.findFirst({ where: { recipientUserId: created.id, trigger: "admin_invited" } });
    expect(log?.status).toBe("SENT");
    expect(log?.preview).toBeNull(); // følsom: indholdet med linket gemmes ikke
    const audits = (await prisma.auditLog.findMany({ where: { entityId: created.id } })).map((a) => a.action);
    expect(audits).toEqual(expect.arrayContaining(["admin.create", "admin.invite"]));
    // Dublet afvises med en forklaring
    expect((await inviteAdminAction({}, formData({ name: "Ny Administrator", email }))).error).toMatch(/allerede inviteret/);
  });

  it("login med kode: sessionen roteres, «Husk denne enhed» springer koden over næste gang (adgangskoden kræves stadig)", async () => {
    const { prisma } = await import("@/lib/db");
    const { totp } = await import("@/lib/mfa/totp");
    const { loginAction } = await import("./auth");
    const { verifyMfaLoginAction } = await import("./mfa");
    const { user: u, secret } = await user("ADVISOR", { mfa: true });
    const login = () => loginAction({}, formData({ email: u.email, password: "Rigtig-Adgangskode-1" }));
    expect(await redirectOf(login)).toBe("/mfa");
    const pendingToken = cookieJar.get("abu_session")!;
    expect(await redirectOf(() => verifyMfaLoginAction({}, formData({ code: totp(secret), remember: "on" })))).toBe("/dashboard");
    const fullToken = cookieJar.get("abu_session")!;
    expect(fullToken).not.toBe(pendingToken);
    const { sha256 } = await import("@/lib/tokens");
    expect(await prisma.session.findUnique({ where: { id: sha256(pendingToken) } })).toBeNull();
    expect(await prisma.session.findUniqueOrThrow({ where: { id: sha256(fullToken) } })).toMatchObject({ mfaPending: false, mfaVerifiedAt: expect.any(Date) });
    expect(cookieJar.get("abu_device")).toBeTruthy();
    const devices = await prisma.trustedDevice.findMany({ where: { userId: u.id } });
    expect(devices).toHaveLength(1);
    expect(devices[0].label).toBe("Chrome på macOS");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lastLoginAt).not.toBeNull();

    // Næste login fra samme enhed: ingen kode
    cookieJar.delete("abu_session");
    expect(await redirectOf(login)).toBe("/dashboard");
    // … men forkert adgangskode virker stadig ikke
    cookieJar.delete("abu_session");
    expect(await loginAction({}, formData({ email: u.email, password: "forkert-forkert" }))).toMatchObject({ error: expect.stringMatching(/Forkert/) });

    // Skift af adgangskode tilbagekalder enhederne → koden kræves igen
    cookieJar.delete("abu_session");
    await redirectOf(login);
    const { changePasswordAction } = await import("./auth");
    expect((await changePasswordAction({}, formData({ current: "Rigtig-Adgangskode-1", password: "Ny-Adgangskode-2" }))).ok).toMatch(/betroede enheder er fjernet/);
    expect(await prisma.trustedDevice.count({ where: { userId: u.id } })).toBe(0);
    cookieJar.delete("abu_session");
    expect(await redirectOf(() => loginAction({}, formData({ email: u.email, password: "Ny-Adgangskode-2" })))).toBe("/mfa");
  });

  it("tvungen opsætning for admin: kan ikke springes over; bekræftelse giver koder, og først «Jeg har gemt dem» giver fuld adgang", async () => {
    const { prisma } = await import("@/lib/db");
    const { totp } = await import("@/lib/mfa/totp");
    const { getOrStartEnrollment } = await import("@/lib/mfa/service");
    const { getSessionContext } = await import("@/lib/auth");
    const { loginAction } = await import("./auth");
    const { confirmMfaSetupAction, finishMfaSetupAction } = await import("./mfa");
    const { user: a } = await user("ADMIN");
    expect(await redirectOf(() => loginAction({}, formData({ email: a.email, password: "Rigtig-Adgangskode-1" })))).toBe("/mfa/opsaet");
    // «Jeg har gemt dem» uden bekræftet opsætning giver ikke adgang
    expect(await redirectOf(() => finishMfaSetupAction(formData({})))).toBe("/mfa");
    expect((await getSessionContext())?.stage).toBe("mfa_setup");
    const secret = await getOrStartEnrollment(await prisma.user.findUniqueOrThrow({ where: { id: a.id } }));
    expect((await confirmMfaSetupAction({}, formData({ code: "000000" }))).error).toBeTruthy();
    const ok = await confirmMfaSetupAction({}, formData({ code: totp(secret) }));
    expect(ok.codes).toHaveLength(10);
    const before = cookieJar.get("abu_session");
    expect(await redirectOf(() => finishMfaSetupAction(formData({})))).toBe("/admin");
    expect(cookieJar.get("abu_session")).not.toBe(before);
    expect((await getSessionContext())?.stage).toBe("full");
  });

  it("deaktiveret administrator kan ikke logge ind; sessioner og betroede enheder er væk", async () => {
    const { prisma } = await import("@/lib/db");
    const { createTrustedDevice } = await import("@/lib/mfa/service");
    const { deactivateAdmin } = await import("@/lib/admin-users");
    const { loginAction } = await import("./auth");
    const actor = await user("ADMIN", { mfa: true });
    const target = await user("ADMIN", { mfa: true });
    await signIn(target.user.id, { verifiedMinutesAgo: 1 });
    await createTrustedDevice(target.user.id, { userAgent: null, ip: null }, 30);
    expect(await deactivateAdmin(actor.user.id, target.user.id)).toMatchObject({ ok: true });
    expect(await prisma.session.count({ where: { userId: target.user.id } })).toBe(0);
    expect(await prisma.trustedDevice.count({ where: { userId: target.user.id } })).toBe(0);
    const { getCurrentUser } = await import("@/lib/auth");
    expect(await getCurrentUser()).toBeNull();
    cookieJar.clear();
    expect(await loginAction({}, formData({ email: target.user.email, password: "Rigtig-Adgangskode-1" }))).toMatchObject({ error: expect.stringMatching(/deaktiveret/) });
  });
});
