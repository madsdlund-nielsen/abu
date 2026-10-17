import { describe, expect, it } from "vitest";
import { describeDb, uid } from "../test/db";
import { afterFailedLogin, BASE_LOCK_MS, isLocked, lockDurationMs, MAX_LOCK_MS, type LoginState } from "./lockout";

const t0 = new Date("2026-10-17T10:00:00Z");
const fresh: LoginState = { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null };

describe("login-spærring pr. konto (H-2)", () => {
  it("spærrer efter 5 forkerte forsøg i 15 min og eskalerer derefter", () => {
    expect(lockDurationMs(4)).toBe(0);
    expect(lockDurationMs(5)).toBe(BASE_LOCK_MS);
    expect(lockDurationMs(6)).toBe(0);
    expect(lockDurationMs(10)).toBe(2 * BASE_LOCK_MS);
    expect(lockDurationMs(15)).toBe(4 * BASE_LOCK_MS);
    expect(lockDurationMs(500)).toBe(MAX_LOCK_MS);
  });

  it("tæller forsøg i træk og låser ved det 5.", () => {
    let s: LoginState = fresh;
    for (let i = 1; i <= 4; i++) {
      s = afterFailedLogin(s, new Date(t0.getTime() + i * 1000));
      expect(isLocked(s, new Date(t0.getTime() + i * 1000))).toBe(false);
    }
    const r = afterFailedLogin(s, new Date(t0.getTime() + 5000));
    expect(r.lockedNow).toBe(true);
    expect(isLocked(r, new Date(t0.getTime() + 5000 + BASE_LOCK_MS - 1))).toBe(true);
    expect(isLocked(r, new Date(t0.getTime() + 5000 + BASE_LOCK_MS + 1))).toBe(false);
  });

  it("glemmer gamle fejl efter et døgn", () => {
    const s = afterFailedLogin({ failedLoginCount: 4, lastFailedLoginAt: t0, lockedUntil: null }, new Date(t0.getTime() + 25 * 3_600_000));
    expect(s.failedLoginCount).toBe(1);
    expect(s.lockedNow).toBe(false);
  });
});

describeDb("login-spærring i databasen (H-2)", () => {
  it("spærrer kontoen uanset hvilken IP forsøgene kommer fra, og nulstilles", async () => {
    const { prisma } = await import("./db");
    const { recordFailedLogin, resetLoginFailures } = await import("./lockout");
    const user = await prisma.user.create({ data: { email: `${uid("lock")}@test.dk`, name: "Lås Test", role: "CUSTOMER" } });
    // Forsøgene registreres på kontoen; IP indgår slet ikke (roterende X-Forwarded-For er ligegyldigt)
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => recordFailedLogin(user.id)));
    expect(results.filter((r) => r.lockedNow)).toHaveLength(1); // samtidige forsøg tabes ikke
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.failedLoginCount).toBe(5);
    expect(isLocked(locked, new Date())).toBe(true);
    await resetLoginFailures(user.id);
    const ok = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(ok.failedLoginCount).toBe(0);
    expect(isLocked(ok, new Date())).toBe(false);
    await prisma.user.delete({ where: { id: user.id } });
  });
});
