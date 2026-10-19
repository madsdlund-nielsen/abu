import { describe, expect, it } from "vitest";
import { generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode, normalizeRecoveryCode, RECOVERY_CODE_COUNT } from "./recovery";
import { clampTrustedDays, deviceLabel, ipPrefix, isTrustedDeviceValid, trustedDeviceEndsAt, trustedDeviceExpiry } from "./trusted-device";

const DAY = 86_400_000;

describe("betroede enheder: 30 dage, ingen forlængelse", () => {
  const created = new Date("2026-10-01T12:00:00Z");
  const d = { createdAt: created, expiresAt: trustedDeviceExpiry(created, 30) };

  it("udløber præcis 30 dage efter oprettelsen", () => {
    expect(d.expiresAt.toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(isTrustedDeviceValid(d, new Date(created.getTime() + 30 * DAY - 1), 30)).toBe(true);
    expect(isTrustedDeviceValid(d, new Date(created.getTime() + 30 * DAY), 30)).toBe(false);
  });

  it("brug forlænger ikke: udløbet afhænger kun af oprettelsen (ikke af senest brugt)", () => {
    const usedYesterday = { ...d, lastUsedAt: new Date(created.getTime() + 29 * DAY) };
    expect(isTrustedDeviceValid(usedYesterday, new Date(created.getTime() + 31 * DAY), 30)).toBe(false);
    expect(trustedDeviceEndsAt(usedYesterday, 30)).toEqual(d.expiresAt);
  });

  it("indstillingen kan højst være 30 dage; sænkes den, gælder det straks for eksisterende enheder; 0 = slået fra", () => {
    expect(clampTrustedDays(90)).toBe(30);
    expect(clampTrustedDays(-1)).toBe(0);
    expect(clampTrustedDays("14")).toBe(14);
    expect(clampTrustedDays("noget")).toBe(30);
    expect(trustedDeviceExpiry(created, 90)).toEqual(d.expiresAt);
    expect(isTrustedDeviceValid(d, new Date(created.getTime() + 10 * DAY), 7)).toBe(false);
    expect(trustedDeviceEndsAt(d, 7)).toEqual(new Date(created.getTime() + 7 * DAY));
    // Hævet igen: aldrig ud over det gemte udløb
    expect(isTrustedDeviceValid({ createdAt: created, expiresAt: trustedDeviceExpiry(created, 7) }, new Date(created.getTime() + 10 * DAY), 30)).toBe(false);
    expect(isTrustedDeviceValid(d, new Date(created.getTime() + DAY), 0)).toBe(false);
  });

  it("grov enhedsbeskrivelse og omtrentlig IP (ingen fulde adresser eller versioner)", () => {
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")).toBe("Chrome på macOS");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari på iOS");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("Firefox på Windows");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge på Windows");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome på Android");
    expect(deviceLabel(null)).toBe("Ukendt browser på ukendt system");
    expect(ipPrefix("203.0.113.57")).toBe("203.0.113.0/24");
    expect(ipPrefix("::ffff:198.51.100.9")).toBe("198.51.100.0/24");
    expect(ipPrefix("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(ipPrefix("ukendt")).toBeNull();
  });
});

describe("gendannelseskoder", () => {
  it("10 unikke koder à 10 tegn uden forvekslelige tegn", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) {
      expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
      expect(c).not.toMatch(/[01ilo]/);
      expect(looksLikeRecoveryCode(c)).toBe(true);
    }
  });
  it("hash er bundet til brugeren og tåler store bogstaver/mellemrum ved indtastning", () => {
    const [c] = generateRecoveryCodes(1);
    expect(hashRecoveryCode("u1", c)).toBe(hashRecoveryCode("u1", ` ${c.toUpperCase().replace("-", " ")} `));
    expect(hashRecoveryCode("u1", c)).not.toBe(hashRecoveryCode("u2", c));
    expect(hashRecoveryCode("u1", c)).not.toContain(normalizeRecoveryCode(c));
    expect(looksLikeRecoveryCode("123456")).toBe(false);
  });
});

describe("flash-besked med anker", () => {
  it("lægger ?ok= før #anker", async () => {
    const { withFlash } = await import("../redirect");
    expect(withFlash("/account#enheder", "ok", "Fjernet")).toBe("/account?ok=Fjernet#enheder");
    expect(withFlash("/a?x=1", "err", "Nej")).toBe("/a?x=1&err=Nej");
    expect(withFlash("/a", "ok", "æ ø")).toBe("/a?ok=%C3%A6%20%C3%B8");
  });
});
