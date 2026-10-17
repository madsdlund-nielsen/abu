"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import {
  createPasswordToken,
  createSession,
  destroySession,
  findValidPasswordToken,
  hashPassword,
  validatePassword,
  verifyPassword,
} from "@/lib/auth";
import { getClientIp } from "@/lib/client-ip";
import { isLocked, LOCK_THRESHOLD, recordFailedLogin, resetLoginFailures } from "@/lib/lockout";
import { rateLimit, rateLimitIp } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { loginUrlFor, recordingConsentNow, safeNextPath } from "@/lib/consent";
import { currentConsent } from "@/lib/content/server";
import { sendResetEmail } from "@/lib/emails";
import { redirectWith } from "@/lib/redirect";

/** Samme svar, uanset om kontoen findes, er spærret, eller IP'en har brugt sin kvote (ingen konto-oplysninger). */
const TOO_MANY = "For mange forsøg. Vent et kvarter og prøv igen, eller nulstil din adgangskode.";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
  });
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const keep = `${loginUrlFor(next)}${next ? "&" : "?"}e=${encodeURIComponent(String(formData.get("email") ?? "").trim())}`;
  if (!parsed.success) redirectWith(keep, "err", "Indtast e-mail og adgangskode.");
  const { email, password } = parsed.data;
  // 1) Grænse pr. betroet klient-IP (mod password spraying på tværs af konti)
  if (!(await rateLimitIp("login-ip", await getClientIp(), 50))) redirectWith(keep, "err", TOO_MANY);

  // 2) Spærring pr. konto i databasen – uafhængig af IP, så skiftende X-Forwarded-For ikke hjælper (H-2)
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && isLocked(user, new Date())) redirectWith(keep, "err", TOO_MANY);
  // Ukendte e-mails spærres efter samme antal forsøg, så svaret ikke afslører, om kontoen findes
  if (!user && !(await rateLimit(`login-unknown:${email}`, LOCK_THRESHOLD))) redirectWith(keep, "err", TOO_MANY);

  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !ok) {
    if (user) {
      const r = await recordFailedLogin(user.id);
      if (r.lockedNow) await audit(user.id, "auth.lockout", "User", user.id, `Spærret til ${r.lockedUntil?.toISOString()}`);
    }
    redirectWith(keep, "err", "Forkert e-mail eller adgangskode.");
  }

  if (user.failedLoginCount > 0 || user.lockedUntil) await resetLoginFailures(user.id);
  await createSession(user.id);
  await audit(user.id, "auth.login", "User", user.id);
  // Eksisterende brugere uden registreret samtykke accepterer én gang ved næste login
  if (!user.recordingConsentAt) redirect(next ? `/samtykke?next=${encodeURIComponent(next)}` : "/samtykke");
  // Tilbage til det dybe link (plan #21); rollekontrollen sker på siden selv
  redirect(next ?? (user.role === "ADMIN" ? "/admin" : "/dashboard"));
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

export async function requestResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!(await rateLimitIp("reset-ip", await getClientIp(), 5)) || (email && !(await rateLimit(`reset-email:${email}`, 3, 60 * 60_000)))) {
    redirectWith("/reset-password", "err", "For mange forsøg. Prøv igen senere.");
  }
  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  if (user) {
    const { token } = await createPasswordToken(user.id, "RESET");
    await sendResetEmail(user, token);
  }
  // Samme svar uanset om kontoen findes (ingen konto-opslag)
  redirectWith("/reset-password", "ok", "Hvis e-mailen findes hos os, har vi sendt et link til at nulstille adgangskoden.");
}

export async function setPasswordAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const back = `/set-password?token=${encodeURIComponent(token)}`;
  const row = await findValidPasswordToken(token);
  if (!row) redirectWith("/login", "err", "Linket er ugyldigt eller udløbet. Bed om et nyt.");
  const err = validatePassword(password);
  if (err) redirectWith(back, "err", err);
  if (password !== confirm) redirectWith(back, "err", "Adgangskoderne er ikke ens.");
  // Rådgivere giver samtykke til optagelse og transskription, når de accepterer invitationen
  const giveConsent = row.purpose === "INVITE";
  if (giveConsent && formData.get("recordingConsent") !== "on") {
    redirectWith(back, "err", "Du skal give samtykke til optagelse og transskription af møder for at fortsætte.");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      // Ny adgangskode via engangslink ophæver en evt. login-spærring
      data: {
        passwordHash: await hashPassword(password),
        failedLoginCount: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
        ...(giveConsent ? recordingConsentNow((await currentConsent("recording")).version) : {}),
      },
    }),
    prisma.passwordToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    // Log alle andre sessioner ud
    prisma.session.deleteMany({ where: { userId: row.userId } }),
  ]);
  await audit(row.userId, `auth.password_${row.purpose.toLowerCase()}`, "User", row.userId);
  await createSession(row.userId);
  redirect(row.user.role === "ADMIN" ? "/admin" : "/dashboard");
}

export async function changePasswordAction(formData: FormData) {
  const { requireUser } = await import("@/lib/auth");
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("password") ?? "");
  if (!(await verifyPassword(current, user.passwordHash))) redirectWith("/account", "err", "Nuværende adgangskode er forkert.");
  const err = validatePassword(next);
  if (err) redirectWith("/account", "err", err);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  await audit(user.id, "auth.password_change", "User", user.id);
  redirectWith("/account", "ok", "Adgangskoden er ændret.");
}

