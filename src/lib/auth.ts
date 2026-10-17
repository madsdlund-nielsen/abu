import bcrypt from "bcryptjs";
import type { Role, User } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { prisma } from "./db";
import { cookieSecure } from "./env";
import { randomToken, sha256 } from "./tokens";

export const SESSION_COOKIE = "abu_session";
const SESSION_DAYS = 14;
export { MIN_PASSWORD_LENGTH } from "./auth-constants";
import { MIN_PASSWORD_LENGTH as MIN_LEN } from "./auth-constants";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

let dummyHash: Promise<string> | null = null;

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  // Sammenlign altid (mod dummy-hash) for at undgå timing-forskelle på ukendte brugere
  dummyHash ??= bcrypt.hash("dummy-password", 12);
  const ok = await bcrypt.compare(password, hash ?? (await dummyHash));
  return ok && hash !== null;
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_LEN) return `Adgangskoden skal være mindst ${MIN_LEN} tegn.`;
  return null;
}

export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({ data: { id: sha256(token), userId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { id: sha256(token) }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<User> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}

// --- Password tokens (invite / reset) ---
export async function createPasswordToken(userId: string, purpose: "INVITE" | "RESET") {
  const token = randomToken();
  const days = purpose === "INVITE" ? 7 : 0;
  const expiresAt = new Date(Date.now() + (days ? days * 86_400_000 : 2 * 3_600_000));
  await prisma.passwordToken.create({ data: { userId, tokenHash: sha256(token), purpose, expiresAt } });
  return { token, expiresAt };
}

export async function findValidPasswordToken(token: string) {
  const row = await prisma.passwordToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  return row;
}
