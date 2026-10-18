import type { User } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { audit } from "./audit";
import { createSession, type SessionContext, type SessionStage } from "./auth";
import { getClientIp } from "./client-ip";
import { safeNextPath } from "./consent";
import { prisma } from "./db";
import { cookieSecure } from "./env";
import { createTrustedDevice, getTrustedDeviceDays, matchTrustedDevice } from "./mfa/service";
import { DEVICE_COOKIE } from "./mfa/trusted-device";

/**
 * Login-forløbet efter en godkendt adgangskode (login, valg af adgangskode via link):
 *  - MFA slået til: betroet enhed (gyldig cookie for netop denne bruger) → fuld session; ellers en ventende session → /mfa.
 *  - ADMIN uden MFA: ventende session → /mfa/opsaet (påkrævet).
 *  - Andre uden MFA: fuld session.
 * Adgangskoden kræves altid; en betroet enhed springer kun koden over.
 */
export async function beginSignIn(user: User): Promise<SessionStage> {
  if (user.mfaEnabledAt) {
    const device = await matchTrustedDevice(user.id, (await cookies()).get(DEVICE_COOKIE)?.value);
    if (device) {
      await createSession(user.id, { trustedDeviceId: device.id });
      await markLogin(user.id);
      await audit(user.id, "auth.login_trusted_device", "TrustedDevice", device.id, device.label);
      return "full";
    }
    await createSession(user.id, { mfaPending: true });
    return "mfa_verify";
  }
  if (user.role === "ADMIN") {
    await createSession(user.id, { mfaPending: true });
    return "mfa_setup";
  }
  await createSession(user.id);
  await markLogin(user.id);
  return "full";
}

export async function markLogin(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}

/**
 * Koden er godkendt (login eller opsætning): sessionen roteres (nyt token, den ventende slettes) og markeres som
 * bekræftet nu. Med «Husk denne enhed» oprettes en betroet enhed og cookien sættes.
 */
export async function completeSecondFactor(ctx: SessionContext, opts: { trustDevice?: boolean } = {}): Promise<void> {
  const now = new Date();
  if (opts.trustDevice) {
    const days = await getTrustedDeviceDays();
    if (days > 0) {
      const h = await headers();
      const { token, device } = await createTrustedDevice(ctx.user.id, { userAgent: h.get("user-agent"), ip: await getClientIp() }, days, now);
      (await cookies()).set(DEVICE_COOKIE, token, { httpOnly: true, secure: cookieSecure(), sameSite: "lax", path: "/", expires: device.expiresAt });
    }
  }
  await createSession(ctx.user.id, { mfaVerifiedAt: now, trustedDeviceId: ctx.stage === "full" ? ctx.session.trustedDeviceId : null });
  if (ctx.stage !== "full") {
    await markLogin(ctx.user.id);
    await audit(ctx.user.id, "auth.mfa_login", "User", ctx.user.id);
  }
}

/** Slet enhedscookien (fx når brugeren fjerner den betroede enhed, hun sidder på). */
export async function clearDeviceCookie(): Promise<void> {
  (await cookies()).delete(DEVICE_COOKIE);
}

/** Hvor brugeren lander efter et fuldt login: samtykke-porten først, ellers det dybe link eller forsiden for rollen. */
export function landingPath(user: Pick<User, "role" | "recordingConsentAt">, next: string | null | undefined): string {
  const safe = safeNextPath(next);
  const target = safe && !safe.startsWith("/mfa") ? safe : null;
  if (!user.recordingConsentAt) return target ? `/samtykke?next=${encodeURIComponent(target)}` : "/samtykke";
  return target ?? (user.role === "ADMIN" ? "/admin" : "/dashboard");
}
