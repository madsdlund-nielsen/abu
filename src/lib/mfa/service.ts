import type { Prisma, TrustedDevice, User } from "@prisma/client";
import { raiseAlert } from "../alerts";
import { audit } from "../audit";
import { prisma } from "../db";
import { withSystemContext } from "../db-context";
import { getEnv } from "../env";
import { isLocked, recordFailedMfa } from "../lockout";
import { rateLimit, rateLimitIp } from "../rate-limit";
import { randomToken, sha256 } from "../tokens";
import { decryptSecret, encryptSecret, keyIdOf, MfaDecryptError, mfaKeysFrom, type MfaKey } from "./crypto";
import { generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode } from "./recovery";
import { generateTotpSecret, normalizeTotpCode, verifyTotp } from "./totp";
import {
  clampTrustedDays,
  deviceLabel,
  ipPrefix,
  isTrustedDeviceValid,
  TRUSTED_DEVICE_DAYS_DEFAULT,
  TRUSTED_DEVICE_SETTING,
  trustedDeviceExpiry,
} from "./trusted-device";

// --------------------------------------------------------------------------- Nøgler og kryptering

let keysOverride: MfaKey[] | null = null;
/** Kun til tests (rotation). */
export function setMfaKeysForTests(keys: MfaKey[] | null) {
  keysOverride = keys;
}

export function getMfaKeys(): MfaKey[] {
  if (keysOverride) return keysOverride;
  const env = getEnv();
  return mfaKeysFrom(env.MFA_ENCRYPTION_KEY, env.MFA_ENCRYPTION_KEY_PREVIOUS);
}

/** Associated data: chifferteksten hører til netop denne bruger. */
const aadFor = (userId: string) => `abu-user:${userId}`;

export function sealSecret(userId: string, secretB32: string, keys = getMfaKeys()): { enc: string; keyId: string } {
  return { enc: encryptSecret(secretB32, keys[0], aadFor(userId)), keyId: keys[0].id };
}

export function openSecret(userId: string, enc: string, keys = getMfaKeys()): string {
  return decryptSecret(enc, keys, aadFor(userId));
}

// --------------------------------------------------------------------------- Rate limits og fejl

/** Pr. bruger og pr. betroet klient-IP (Postgres-lageret). Derudover spærres kontoen efter 5 forkerte koder (H-2). */
export const MFA_USER_LIMIT = 10;
export const MFA_IP_LIMIT = 30;
const WINDOW_MS = 15 * 60_000;

export const MFA_TOO_MANY = "For mange forsøg. Vent et kvarter og prøv igen.";
export const MFA_WRONG = "Koden er forkert eller udløbet. Prøv igen med den kode, appen viser nu.";
export const MFA_REPLAY = "Koden er allerede brugt. Vent på den næste kode i appen.";
export const MFA_FORMAT = "Indtast den 6-cifrede kode fra din godkendelses-app.";
export const MFA_RECOVERY_WRONG = "Gendannelseskoden er forkert eller allerede brugt.";

async function attemptAllowed(userId: string, ip: string): Promise<boolean> {
  const byIp = await rateLimitIp("mfa-ip", ip, MFA_IP_LIMIT, WINDOW_MS);
  const byUser = await rateLimit(`mfa-user:${userId}`, MFA_USER_LIMIT, WINDOW_MS);
  return byIp && byUser;
}

export type MfaPurpose = "login" | "reverify" | "setup" | "regenerate" | "disable";

async function failed(userId: string, purpose: MfaPurpose, reason: string): Promise<boolean> {
  const r = await recordFailedMfa(userId);
  await audit(userId, "auth.mfa_failed", "User", userId, `${purpose}: ${reason}`);
  if (r.lockedNow) await audit(userId, "auth.lockout", "User", userId, `Totrinsbekræftelse – spærret til ${r.lockedUntil?.toISOString()}`);
  return r.lockedNow;
}

export type SecondFactorResult =
  | { ok: true; method: "totp" | "recovery"; remainingRecoveryCodes: number }
  | { ok: false; error: string };

export async function remainingRecoveryCodes(userId: string): Promise<number> {
  return prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
}

/**
 * Verificerer en kode fra appen (eller en gendannelseskode) for en bruger med totrinsbekræftelse slået til:
 * rate limit pr. bruger og IP, kontospærring efter gentagne fejl, ±1 trin og ingen genbrug af et trin (replay – atomisk,
 * så to samtidige forsøg med samme kode ikke begge lykkes). Hemmeligheden krypteres om, hvis den bruger en gammel nøgle.
 * Auth-internt (RLS): systemkontekst – også en MFA-ventende session skal kunne verificeres, og tællere/spærring er ikke
 * felter, brugeren selv må skrive. `userId` kommer altid fra den aktuelle session (actions/mfa.ts).
 */
export async function verifySecondFactor(
  userId: string,
  input: { code?: string | null; recoveryCode?: string | null },
  ctx: { ip: string; purpose: MfaPurpose; allowRecovery?: boolean },
  now = new Date(),
): Promise<SecondFactorResult> {
  return withSystemContext("auth.mfa_verify", () => verifySecondFactorAsSystem(userId, input, ctx, now));
}

async function verifySecondFactorAsSystem(
  userId: string,
  input: { code?: string | null; recoveryCode?: string | null },
  ctx: { ip: string; purpose: MfaPurpose; allowRecovery?: boolean },
  now: Date,
): Promise<SecondFactorResult> {
  const useRecovery = Boolean(input.recoveryCode?.trim()) && ctx.allowRecovery !== false;
  if (!useRecovery && !/^\d{6}$/.test(normalizeTotpCode(input.code ?? ""))) return { ok: false, error: MFA_FORMAT };
  if (!(await attemptAllowed(userId, ctx.ip))) return { ok: false, error: MFA_TOO_MANY };
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.mfaEnabledAt || !user.mfaSecretEnc) return { ok: false, error: "Totrinsbekræftelse er ikke slået til." };
  if (isLocked(user, now)) return { ok: false, error: MFA_TOO_MANY };

  if (useRecovery) {
    const code = input.recoveryCode ?? "";
    const used = looksLikeRecoveryCode(code)
      ? await prisma.mfaRecoveryCode.updateMany({ where: { userId, codeHash: hashRecoveryCode(userId, code), usedAt: null }, data: { usedAt: now } })
      : { count: 0 };
    if (used.count !== 1) {
      const locked = await failed(userId, ctx.purpose, "gendannelseskode");
      return { ok: false, error: locked ? MFA_TOO_MANY : MFA_RECOVERY_WRONG };
    }
    await prisma.user.update({ where: { id: userId }, data: { mfaFailedCount: 0, mfaLastFailedAt: null } });
    const remaining = await remainingRecoveryCodes(userId);
    await audit(userId, "auth.mfa_recovery_used", "User", userId, `${ctx.purpose}; ${remaining} tilbage`);
    return { ok: true, method: "recovery", remainingRecoveryCodes: remaining };
  }

  let secret: string;
  const keys = getMfaKeys();
  try {
    secret = openSecret(userId, user.mfaSecretEnc, keys);
  } catch (e) {
    await raiseAlert("mfa_decrypt_failed", `En TOTP-hemmelighed kunne ikke dekrypteres (${e instanceof MfaDecryptError ? e.message : "ukendt fejl"}). Tjek MFA_ENCRYPTION_KEY/MFA_ENCRYPTION_KEY_PREVIOUS.`);
    return { ok: false, error: "Totrinsbekræftelsen kan ikke læses lige nu. Brug en gendannelseskode, eller kontakt en administrator." };
  }
  let check = verifyTotp(secret, input.code ?? "", now, user.mfaLastUsedStep);
  if (check.ok) {
    // Atomisk mod replay: kun hvis trinnet stadig er nyere end det senest brugte
    const rotate = keyIdOf(user.mfaSecretEnc) !== keys[0].id ? sealSecret(userId, secret, keys) : null;
    const upd = await prisma.user.updateMany({
      where: { id: userId, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: check.step } }] },
      data: { mfaLastUsedStep: check.step, mfaFailedCount: 0, mfaLastFailedAt: null, ...(rotate ? { mfaSecretEnc: rotate.enc, mfaKeyId: rotate.keyId } : {}) },
    });
    if (upd.count === 1) return { ok: true, method: "totp", remainingRecoveryCodes: await remainingRecoveryCodes(userId) };
    check = { ok: false, reason: "replay" };
  }
  if (check.reason === "format") return { ok: false, error: MFA_FORMAT };
  const locked = await failed(userId, ctx.purpose, check.reason === "replay" ? "genbrugt kode" : "forkert kode");
  return { ok: false, error: locked ? MFA_TOO_MANY : check.reason === "replay" ? MFA_REPLAY : MFA_WRONG };
}

// --------------------------------------------------------------------------- Opsætning

/** En påbegyndt opsætning (QR-koden) gælder så længe; derefter laves en ny hemmelighed. */
export const ENROLLMENT_TTL_MS = 30 * 60_000;

/**
 * Hemmeligheden til QR-koden: genbruger en påbegyndt opsætning (så en genindlæsning ikke skifter koden), ellers en ny.
 * Auth-internt (RLS): en admin, der skal opsætte MFA, har kun en ventende session (systemkontekst).
 */
export async function getOrStartEnrollment(user: Pick<User, "id" | "mfaPendingSecretEnc" | "mfaPendingCreatedAt">, now = new Date()): Promise<string> {
  if (user.mfaPendingSecretEnc && user.mfaPendingCreatedAt && now.getTime() - user.mfaPendingCreatedAt.getTime() < ENROLLMENT_TTL_MS) {
    try {
      return openSecret(user.id, user.mfaPendingSecretEnc);
    } catch {
      // ny nøgle eller ulæselig: start forfra
    }
  }
  const secret = generateTotpSecret();
  await withSystemContext("auth.mfa_enrollment", () =>
    prisma.user.update({ where: { id: user.id }, data: { mfaPendingSecretEnc: sealSecret(user.id, secret).enc, mfaPendingCreatedAt: now }, select: { id: true } }),
  );
  return secret;
}

async function replaceRecoveryCodes(tx: Prisma.TransactionClient, userId: string, codes: string[]) {
  await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
  await tx.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(userId, c) })) });
}

/**
 * Bekræfter opsætningen med en gyldig kode fra appen: først nu slås totrinsbekræftelse til. Returnerer 10 nye
 * gendannelseskoder i klartekst – de vises én gang og gemmes kun som hash. Auth-internt (RLS): systemkontekst.
 */
export async function confirmEnrollment(userId: string, code: string, ip: string, now = new Date()): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  return withSystemContext("auth.mfa_enrollment", () => confirmEnrollmentAsSystem(userId, code, ip, now));
}

async function confirmEnrollmentAsSystem(userId: string, code: string, ip: string, now: Date): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  if (!/^\d{6}$/.test(normalizeTotpCode(code))) return { ok: false, error: MFA_FORMAT };
  if (!(await attemptAllowed(userId, ip))) return { ok: false, error: MFA_TOO_MANY };
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "Brugeren findes ikke." };
  if (user.mfaEnabledAt) return { ok: false, error: "Totrinsbekræftelse er allerede slået til." };
  if (isLocked(user, now)) return { ok: false, error: MFA_TOO_MANY };
  if (!user.mfaPendingSecretEnc || !user.mfaPendingCreatedAt || now.getTime() - user.mfaPendingCreatedAt.getTime() > ENROLLMENT_TTL_MS) {
    return { ok: false, error: "Opsætningen er udløbet. Genindlæs siden, og scan den nye QR-kode." };
  }
  let secret: string;
  try {
    secret = openSecret(userId, user.mfaPendingSecretEnc);
  } catch {
    return { ok: false, error: "Opsætningen er udløbet. Genindlæs siden, og scan den nye QR-kode." };
  }
  const check = verifyTotp(secret, code, now, null);
  if (!check.ok) {
    const locked = await failed(userId, "setup", "forkert kode ved opsætning");
    return { ok: false, error: locked ? MFA_TOO_MANY : MFA_WRONG };
  }
  const codes = generateRecoveryCodes();
  const sealed = sealSecret(userId, secret);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        mfaEnabledAt: now,
        mfaSecretEnc: sealed.enc,
        mfaKeyId: sealed.keyId,
        mfaLastUsedStep: check.step,
        mfaPendingSecretEnc: null,
        mfaPendingCreatedAt: null,
        mfaFailedCount: 0,
        mfaLastFailedAt: null,
      },
    });
    await replaceRecoveryCodes(tx, userId, codes);
  });
  await audit(userId, "auth.mfa_enabled", "User", userId);
  return { ok: true, codes };
}

/** Nye gendannelseskoder (kræver en gyldig kode fra appen). De gamle holder op med at virke. */
export async function regenerateRecoveryCodes(userId: string, code: string, ip: string): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  const r = await verifySecondFactor(userId, { code }, { ip, purpose: "regenerate", allowRecovery: false });
  if (!r.ok) return r;
  const codes = generateRecoveryCodes();
  await withSystemContext("auth.mfa_recovery_codes", () => prisma.$transaction((tx) => replaceRecoveryCodes(tx, userId, codes)));
  await audit(userId, "auth.mfa_recovery_regenerated", "User", userId);
  return { ok: true, codes };
}

/**
 * Fjerner al MFA-data for en bruger: hemmelighed, opsætning, gendannelseskoder og betroede enheder. Kaldes efter en
 * godkendt kode (brugeren selv) eller af en administrator med frisk kode. Auth-internt (RLS): gendannelseskoderne er
 * kun tilgængelige i systemkontekst.
 */
export async function clearMfaData(userId: string): Promise<void> {
  await withSystemContext("auth.mfa_clear", () =>
    prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { mfaEnabledAt: null, mfaSecretEnc: null, mfaKeyId: null, mfaPendingSecretEnc: null, mfaPendingCreatedAt: null, mfaLastUsedStep: null, mfaFailedCount: 0, mfaLastFailedAt: null },
        select: { id: true },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.trustedDevice.deleteMany({ where: { userId } });
    }),
  );
}

/** Valgfri MFA (rådgiver/kunde) slås fra med en gyldig kode eller gendannelseskode. Administratorer kan ikke. */
export async function disableMfa(user: Pick<User, "id" | "role">, input: { code?: string; recoveryCode?: string }, ip: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (user.role === "ADMIN") return { ok: false, error: "Totrinsbekræftelse er påkrævet for administratorer og kan ikke slås fra." };
  const r = await verifySecondFactor(user.id, input, { ip, purpose: "disable" });
  if (!r.ok) return r;
  const devices = await prisma.trustedDevice.count({ where: { userId: user.id } });
  await clearMfaData(user.id);
  await audit(user.id, "auth.mfa_disabled", "User", user.id);
  if (devices) await audit(user.id, "auth.devices_revoked", "User", user.id, `MFA slået fra; ${devices} enhed(er)`);
  return { ok: true };
}

// --------------------------------------------------------------------------- Betroede enheder

export async function getTrustedDeviceDays(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: TRUSTED_DEVICE_SETTING } });
  return row ? clampTrustedDays(row.value) : TRUSTED_DEVICE_DAYS_DEFAULT;
}

export async function setTrustedDeviceDays(days: number): Promise<number> {
  const v = clampTrustedDays(days);
  await prisma.appSetting.upsert({ where: { key: TRUSTED_DEVICE_SETTING }, update: { value: String(v) }, create: { key: TRUSTED_DEVICE_SETTING, value: String(v) } });
  return v;
}

/**
 * Ny betroet enhed: tilfældigt token til cookien, kun hash i databasen. Udløbet er fast (forlænges ikke ved brug).
 * Auth-internt (RLS): oprettes kun lige efter en godkendt kode (completeSecondFactor), i systemkontekst.
 */
export async function createTrustedDevice(userId: string, meta: { userAgent: string | null; ip: string | null }, days: number, now = new Date()) {
  const token = randomToken();
  const device = await withSystemContext("auth.trusted_device", () =>
    prisma.trustedDevice.create({
      data: { userId, tokenHash: sha256(token), label: deviceLabel(meta.userAgent), ipPrefix: ipPrefix(meta.ip), createdAt: now, expiresAt: trustedDeviceExpiry(now, days) },
    }),
  );
  await audit(userId, "auth.device_trusted", "TrustedDevice", device.id, `${device.label}; til ${device.expiresAt.toISOString()}`);
  return { token, device };
}

/**
 * Gyldig betroet enhed for brugeren ud fra cookiens token – eller null. Opdaterer kun «senest brugt», aldrig udløbet.
 * Auth-internt (RLS): slås op ved login, før der findes en session (systemkontekst).
 */
export async function matchTrustedDevice(userId: string, token: string | null | undefined, now = new Date()): Promise<TrustedDevice | null> {
  if (!token) return null;
  return withSystemContext("auth.trusted_device", async () => {
    const device = await prisma.trustedDevice.findUnique({ where: { tokenHash: sha256(token) } });
    if (!device || device.userId !== userId) return null;
    if (!isTrustedDeviceValid(device, now, await getTrustedDeviceDays())) return null;
    return prisma.trustedDevice.update({ where: { id: device.id }, data: { lastUsedAt: now } });
  });
}

export async function listTrustedDevices(userId: string, now = new Date()) {
  const days = await getTrustedDeviceDays();
  const rows = await prisma.trustedDevice.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.filter((d) => isTrustedDeviceValid(d, now, days));
}

export type DeviceRevocationReason = "password_change" | "password_reset" | "mfa_reset" | "mfa_disabled" | "admin_deactivated" | "account_deleted" | "user" | "admin";

/** Tilbagekalder alle brugerens betroede enheder (adgangskode skiftet/nulstillet, MFA nulstillet/slået fra, deaktivering …). */
export async function revokeTrustedDevices(userId: string, reason: DeviceRevocationReason, actorId: string | null = userId): Promise<number> {
  const { count } = await prisma.trustedDevice.deleteMany({ where: { userId } });
  if (count) await audit(actorId, "auth.devices_revoked", "User", userId, `${reason}; ${count} enhed(er)`);
  return count;
}

export async function revokeTrustedDevice(userId: string, deviceId: string): Promise<boolean> {
  const { count } = await prisma.trustedDevice.deleteMany({ where: { id: deviceId, userId } });
  if (count) await audit(userId, "auth.device_revoked", "TrustedDevice", deviceId);
  return count === 1;
}

/** Oprydning (jobkøen): udløbne enheder slettes. */
export async function cleanupTrustedDevices(now = new Date()): Promise<number> {
  return (await prisma.trustedDevice.deleteMany({ where: { expiresAt: { lt: now } } })).count;
}
