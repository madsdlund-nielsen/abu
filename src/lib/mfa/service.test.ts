import { afterAll, expect, it, vi } from "vitest";
import { asAnon, asSystem, asUser, createTestUser, describeDb, uid } from "../../test/db";
import { generateTotpSecret, totp, totpStep } from "./totp";

vi.mock("next/headers", async () => (await import("../../test/request")).nextHeadersMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/** Ny tilfældig klient-IP pr. kald, så grænsen pr. IP (delt mellem testfiler og kørsler) ikke rammes. */
const rnd = () => Math.floor(Math.random() * 250) + 1;
const ipNow = () => `10.${rnd()}.${rnd()}.${rnd()}`;

describeDb("totrinsbekræftelse mod databasen", () => {
  const ids: string[] = [];
  afterAll(async () => {
    const { prisma } = await import("../db");
    await asSystem(() => prisma.user.deleteMany({ where: { id: { in: ids } } }));
  });
  // MFA-funktionerne kører selv i systemkontekst (auth-internt); testdata og kontrol også. Det, brugeren selv ser
  // (antal koder, betroede enheder, eksport) køres som brugeren; admin-handlinger som en administrator.

  /** Bruger med MFA slået til (krypteret hemmelighed) og 10 gendannelseskoder. */
  async function mfaUser(role: "ADMIN" | "ADVISOR" | "CUSTOMER" = "ADVISOR") {
    const { prisma } = await import("../db");
    const { confirmEnrollment, getOrStartEnrollment } = await import("./service");
    const u = await asSystem(() => prisma.user.create({ data: { email: `${uid("mfa")}@test.dk`, name: "Mette MFA", role, passwordHash: "x" } }));
    ids.push(u.id);
    // Opsætningen sker fra en MFA-ventende session (anon) – funktionerne skifter selv til systemkontekst
    const secret = await asAnon(() => getOrStartEnrollment(u));
    // Opsætningen bekræftes med koden fra forrige trin, så «nu» er frit til testene
    const r = await asAnon(() => confirmEnrollment(u.id, totp(secret, Date.now() - 30_000), ipNow()));
    if (!r.ok) throw new Error(r.error);
    return { user: u, secret, codes: r.codes };
  }

  it("opsætning: først en gyldig kode slår MFA til; hemmeligheden og koderne gemmes aldrig i klartekst", () => asSystem(async () => {
    const { prisma } = await import("../db");
    const { confirmEnrollment, getOrStartEnrollment } = await import("./service");
    const u = await prisma.user.create({ data: { email: `${uid("enr")}@test.dk`, name: "Ny", role: "CUSTOMER", passwordHash: "x" } });
    ids.push(u.id);
    const secret = await getOrStartEnrollment(u);
    // Genindlæsning giver samme hemmelighed (samme QR-kode)
    expect(await getOrStartEnrollment(await prisma.user.findUniqueOrThrow({ where: { id: u.id } }))).toBe(secret);
    expect(await confirmEnrollment(u.id, "000000", ipNow())).toMatchObject({ ok: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).mfaEnabledAt).toBeNull();
    const r = await confirmEnrollment(u.id, totp(secret), ipNow());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.codes).toHaveLength(10);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.mfaEnabledAt).not.toBeNull();
    expect(row.mfaPendingSecretEnc).toBeNull();
    expect(row.mfaSecretEnc).toMatch(/^v1\./);
    expect(row.mfaSecretEnc).not.toContain(secret);
    expect(row.mfaKeyId).toBeTruthy();
    const stored = await prisma.mfaRecoveryCode.findMany({ where: { userId: u.id } });
    expect(stored).toHaveLength(10);
    for (const c of r.codes) expect(stored.some((s) => s.codeHash.includes(c.replace("-", "")))).toBe(false);
    expect((await prisma.auditLog.findMany({ where: { entityId: u.id } })).map((a) => a.action)).toContain("auth.mfa_enabled");
  }));

  it("gyldig kode virker én gang (replay afvises), næste trin virker", () => asSystem(async () => {
    const { verifySecondFactor } = await import("./service");
    const { user, secret } = await mfaUser();
    const now = new Date();
    const code = totp(secret, now);
    // Login trin 2 kommer fra en MFA-ventende session (anon)
    expect(await asAnon(() => verifySecondFactor(user.id, { code }, { ip: ipNow(), purpose: "login" }, now))).toMatchObject({ ok: true, method: "totp" });
    expect(await verifySecondFactor(user.id, { code }, { ip: ipNow(), purpose: "login" }, now)).toEqual({ ok: false, error: expect.stringMatching(/allerede brugt/) });
    const later = new Date(now.getTime() + 30_000);
    expect(await verifySecondFactor(user.id, { code: totp(secret, later) }, { ip: ipNow(), purpose: "login" }, later)).toMatchObject({ ok: true });
  }));

  it("samtidige forsøg med samme kode: kun ét lykkes (atomisk replay-værn)", () => asSystem(async () => {
    const { verifySecondFactor } = await import("./service");
    const { user, secret } = await mfaUser();
    const now = new Date();
    const code = totp(secret, now);
    const results = await Promise.all([1, 2, 3].map(() => verifySecondFactor(user.id, { code }, { ip: ipNow(), purpose: "login" }, now)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  }));

  it("gendannelseskode virker kun én gang og tæller ned", () => asSystem(async () => {
    const { verifySecondFactor, remainingRecoveryCodes } = await import("./service");
    const { user, codes } = await mfaUser();
    const r = await verifySecondFactor(user.id, { recoveryCode: codes[3].toUpperCase() }, { ip: ipNow(), purpose: "login" });
    expect(r).toEqual({ ok: true, method: "recovery", remainingRecoveryCodes: 9 });
    expect(await verifySecondFactor(user.id, { recoveryCode: codes[3] }, { ip: ipNow(), purpose: "login" })).toMatchObject({ ok: false, error: expect.stringMatching(/allerede brugt/) });
    expect(await asUser(user, () => remainingRecoveryCodes(user.id))).toBe(9);
    // Re-verifikation til følsomme handlinger accepterer ikke gendannelseskoder
    expect(await verifySecondFactor(user.id, { code: "", recoveryCode: codes[4] }, { ip: ipNow(), purpose: "reverify", allowRecovery: false })).toMatchObject({ ok: false });
    expect(await asUser(user, () => remainingRecoveryCodes(user.id))).toBe(9);
    // Andre (også en anden indlogget bruger) ser ikke koderne
    expect(await asUser({ id: "en-anden", role: "ADVISOR" }, () => remainingRecoveryCodes(user.id))).toBe(0);
  }));

  it("nye gendannelseskoder kræver en aktuel kode og ugyldiggør de gamle", () => asSystem(async () => {
    const { regenerateRecoveryCodes, verifySecondFactor } = await import("./service");
    const { user, secret, codes } = await mfaUser();
    expect(await regenerateRecoveryCodes(user.id, "123456", ipNow())).toMatchObject({ ok: false });
    const r = await regenerateRecoveryCodes(user.id, totp(secret), ipNow());
    expect(r.ok).toBe(true);
    expect(await verifySecondFactor(user.id, { recoveryCode: codes[0] }, { ip: ipNow(), purpose: "login" })).toMatchObject({ ok: false });
    if (r.ok) expect(await verifySecondFactor(user.id, { recoveryCode: r.codes[0] }, { ip: ipNow(), purpose: "login" })).toMatchObject({ ok: true });
  }));

  it("5 forkerte koder spærrer kontoen (som H-2); også den rigtige kode afvises derefter, og det audit-logges", () => asSystem(async () => {
    const { prisma } = await import("../db");
    const { verifySecondFactor } = await import("./service");
    const { user, secret } = await mfaUser();
    const now = new Date();
    const wrong = String((Number(totp(secret, now)) + 1) % 1_000_000).padStart(6, "0");
    for (let i = 0; i < 5; i++) await verifySecondFactor(user.id, { code: wrong }, { ip: ipNow(), purpose: "login" }, now);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.mfaFailedCount).toBe(5);
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(now.getTime() + 14 * 60_000);
    expect(await verifySecondFactor(user.id, { code: totp(secret, now) }, { ip: ipNow(), purpose: "login" }, now)).toEqual({ ok: false, error: expect.stringMatching(/For mange forsøg/) });
    const actions = (await prisma.auditLog.findMany({ where: { entityId: user.id } })).map((a) => a.action);
    expect(actions.filter((a) => a === "auth.mfa_failed")).toHaveLength(5);
    expect(actions).toContain("auth.lockout");
  }));

  it("rate limit pr. bruger i Postgres-lageret", () => asSystem(async () => {
    const { rateLimit } = await import("../rate-limit");
    const { verifySecondFactor, MFA_USER_LIMIT } = await import("./service");
    const { user, secret } = await mfaUser();
    for (let i = 0; i < MFA_USER_LIMIT; i++) await rateLimit(`mfa-user:${user.id}`, MFA_USER_LIMIT);
    expect(await verifySecondFactor(user.id, { code: totp(secret) }, { ip: ipNow(), purpose: "login" })).toEqual({ ok: false, error: expect.stringMatching(/For mange/) });
  }));

  it("nøglerotation: hemmeligheden læses med den forrige nøgle og krypteres om med den nye ved næste brug", () => asSystem(async () => {
    const { prisma } = await import("../db");
    const { deriveMfaKey, encryptSecret, keyIdOf } = await import("./crypto");
    const svc = await import("./service");
    const { user, secret } = await mfaUser();
    const current = svc.getMfaKeys()[0];
    const next = deriveMfaKey("ny-nøgle-til-rotationstest-0123456789-abc");
    // Ny nøgle sat i MFA_ENCRYPTION_KEY, den gamle i MFA_ENCRYPTION_KEY_PREVIOUS
    svc.setMfaKeysForTests([next, current]);
    try {
      const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(keyIdOf(before.mfaSecretEnc!)).toBe(current.id);
      expect(await svc.verifySecondFactor(user.id, { code: totp(secret) }, { ip: ipNow(), purpose: "login" })).toMatchObject({ ok: true });
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.mfaKeyId).toBe(next.id);
      expect(keyIdOf(after.mfaSecretEnc!)).toBe(next.id);
      expect(svc.openSecret(user.id, after.mfaSecretEnc!, [next])).toBe(secret);
      // Uden den gamle nøgle kan en ikke-roteret hemmelighed ikke læses (og det giver en driftsalarm, ikke et login)
      await prisma.user.update({ where: { id: user.id }, data: { mfaSecretEnc: encryptSecret(secret, current, `abu-user:${user.id}`), mfaLastUsedStep: null } });
      svc.setMfaKeysForTests([next]);
      expect(await svc.verifySecondFactor(user.id, { code: totp(secret, Date.now() + 30_000) }, { ip: ipNow(), purpose: "login" }, new Date(Date.now() + 30_000))).toMatchObject({ ok: false, error: expect.stringMatching(/kan ikke læses/) });
    } finally {
      svc.setMfaKeysForTests(null);
    }
  }));

  it("betroet enhed: gyldig for netop brugeren i 30 dage, forlænges ikke ved brug", () => asSystem(async () => {
    const { prisma } = await import("../db");
    const { createTrustedDevice, matchTrustedDevice, setTrustedDeviceDays } = await import("./service");
    const { user } = await mfaUser();
    const { user: other } = await mfaUser();
    const created = new Date(Date.now() - 2 * 86_400_000);
    const { token, device } = await createTrustedDevice(user.id, { userAgent: "Mozilla/5.0 (Macintosh) Chrome/130.0 Safari/537.36", ip: "198.51.100.23" }, 30, created);
    expect(device).toMatchObject({ label: "Chrome på macOS", ipPrefix: "198.51.100.0/24" });
    expect(device.expiresAt.getTime() - created.getTime()).toBe(30 * 86_400_000);
    expect((await prisma.trustedDevice.findUniqueOrThrow({ where: { id: device.id } })).tokenHash).not.toBe(token);
    const used = await matchTrustedDevice(user.id, token);
    expect(used?.lastUsedAt).not.toBeNull();
    expect(used?.expiresAt).toEqual(device.expiresAt);
    expect(await matchTrustedDevice(other.id, token)).toBeNull();
    expect(await matchTrustedDevice(user.id, "forkert")).toBeNull();
    expect(await matchTrustedDevice(user.id, token, new Date(created.getTime() + 30 * 86_400_000))).toBeNull();
    // Admin sænker varigheden: gælder straks
    await asUser({ id: "test-admin", role: "ADMIN" }, () => setTrustedDeviceDays(1));
    try {
      expect(await matchTrustedDevice(user.id, token)).toBeNull();
    } finally {
      await prisma.appSetting.deleteMany({ where: { key: "mfa.trustedDeviceDays" } });
    }
    expect(await matchTrustedDevice(user.id, token)).not.toBeNull();
  }));

  it("slå valgfri MFA fra: kræver kode, fjerner hemmelighed, koder og betroede enheder; administratorer kan ikke", () => asSystem(async () => {
    const { prisma } = await import("../db");
    const { createTrustedDevice, disableMfa } = await import("./service");
    const { user, secret } = await mfaUser("ADVISOR");
    await createTrustedDevice(user.id, { userAgent: null, ip: null }, 30);
    expect(await asUser(user, () => disableMfa(user, { code: "111111" }, ipNow()))).toMatchObject({ ok: false });
    expect(await asUser(user, () => disableMfa(user, { code: totp(secret) }, ipNow()))).toEqual({ ok: true });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ mfaEnabledAt: null, mfaSecretEnc: null, mfaKeyId: null });
    expect(await prisma.trustedDevice.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    const { user: admin, secret: s2 } = await mfaUser("ADMIN");
    expect(await asUser(admin, () => disableMfa(admin, { code: totp(s2) }, ipNow()))).toMatchObject({ ok: false, error: expect.stringMatching(/påkrævet/) });
  }));

  it("GDPR: eksporten viser MFA ja/nej og betroede enheder – ingen hemmeligheder; sletning fjerner al MFA-data", () => asSystem(async () => {
    const { prisma } = await import("../db");
    const { buildDataExport } = await import("../data-export");
    const { eraseUser } = await import("../erasure");
    const { createTrustedDevice } = await import("./service");
    const { user, secret, codes } = await mfaUser("CUSTOMER");
    const { token } = await createTrustedDevice(user.id, { userAgent: "Firefox/131.0 (Windows)", ip: "203.0.113.99" }, 30);
    const exp = await asUser(user, () => buildDataExport(user));
    expect(exp.twoFactor.enabled).toBe(true);
    expect(exp.twoFactor.trustedDevices).toEqual([expect.objectContaining({ label: "Firefox på Windows", ipPrefix: "203.0.113.0/24" })]);
    const json = JSON.stringify(exp);
    expect(json).not.toContain(secret);
    expect(json).not.toContain("mfaSecretEnc");
    expect(json).not.toContain("v1.");
    expect(json).not.toContain(token);
    expect(json).not.toContain(codes[0]);
    const admin = await createTestUser("ADMIN");
    ids.push(admin.id);
    const r = await asUser(admin, () => eraseUser(user.id, admin.id, { payments: { cancelSubscription: async () => {} }, storage: { delete: async () => {} } }));
    expect(r.ok).toBe(true);
    expect(await prisma.trustedDevice.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  }));

  it("tidstrinnet gemmes som heltal (passer i Int til år 4000+)", () => {
    expect(totpStep(Date.now())).toBeLessThan(2 ** 31);
    expect(generateTotpSecret()).toHaveLength(32);
  });
});
