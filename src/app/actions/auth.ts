"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import {
  clearRateLimit,
  createPasswordToken,
  createSession,
  destroySession,
  findValidPasswordToken,
  hashPassword,
  rateLimit,
  validatePassword,
  verifyPassword,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendResetEmail } from "@/lib/emails";
import { redirectWith } from "@/lib/redirect";

async function clientKey(extra: string) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return `${ip}:${extra}`;
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) redirectWith("/login", "err", "Indtast e-mail og adgangskode.");
  const { email, password } = parsed.data;
  const key = await clientKey(email);
  if (!rateLimit(key)) redirectWith("/login", "err", "For mange forsøg. Vent et kvarter og prøv igen.");

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !ok) redirectWith("/login", "err", "Forkert e-mail eller adgangskode.");

  clearRateLimit(key);
  await createSession(user.id);
  await audit(user.id, "auth.login", "User", user.id);
  redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

const signupSchema = z.object({
  name: z.string().trim().min(2, "Indtast dit navn."),
  email: z.string().trim().toLowerCase().email("Ugyldig e-mail."),
  phone: z.string().trim().min(5, "Indtast et telefonnummer."),
  companyName: z.string().trim().min(2, "Indtast firmanavn."),
  cvr: z.string().trim().regex(/^\d{8}$/, "CVR-nummer skal være 8 cifre."),
  address: z.string().trim().optional(),
  password: z.string(),
});

export async function signupAction(formData: FormData) {
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const parsed = signupSchema.safeParse({ ...raw, cvr: (raw.cvr ?? "").replace(/\s/g, "") });
  if (!parsed.success) redirectWith("/signup", "err", parsed.error.issues[0].message);
  if (formData.get("consent") !== "on") {
    redirectWith("/signup", "err", "Du skal acceptere vilkår og privatlivspolitik for at oprette en konto.");
  }
  const d = parsed.data;
  const pwErr = validatePassword(d.password);
  if (pwErr) redirectWith("/signup", "err", pwErr);
  if (!rateLimit(await clientKey("signup"), 10)) redirectWith("/signup", "err", "For mange forsøg. Prøv igen senere.");

  const exists = await prisma.user.findUnique({ where: { email: d.email } });
  if (exists) redirectWith("/signup", "err", "Der findes allerede en konto med den e-mail. Log ind i stedet.");

  const user = await prisma.user.create({
    data: {
      email: d.email,
      name: d.name,
      phone: d.phone,
      role: "CUSTOMER",
      passwordHash: await hashPassword(d.password),
      consentAt: new Date(),
      customerProfile: {
        create: { companyName: d.companyName, cvr: d.cvr, address: d.address ?? "", billingEmail: d.email },
      },
    },
  });
  await createSession(user.id);
  await audit(user.id, "auth.signup", "User", user.id);
  redirect("/subscribe");
}

export async function requestResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!rateLimit(await clientKey("reset"), 5)) redirectWith("/reset-password", "err", "For mange forsøg. Prøv igen senere.");
  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  if (user) {
    const { token } = await createPasswordToken(user.id, "RESET");
    await sendResetEmail(user.email, user.name, token);
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

  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password) } }),
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

