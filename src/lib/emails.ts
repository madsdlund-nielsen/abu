import type { User } from "@prisma/client";
import { getEnv } from "./env";
import { accountEvents } from "./notifications/service";

const appUrl = () => getEnv().APP_URL.replace(/\/$/, "");

export function inviteUrl(token: string) {
  return `${appUrl()}/set-password?token=${encodeURIComponent(token)}`;
}

export function resetUrl(token: string) {
  return `${appUrl()}/set-password?token=${encodeURIComponent(token)}&reset=1`;
}

/** Invitation til rådgiver. Teksten redigeres i Admin → Notifikationer (udløser «Rådgiver inviteret»). */
export function sendInviteEmail(user: User, token: string): Promise<boolean> {
  return accountEvents.invited(user, inviteUrl(token));
}

/** Nulstilling af adgangskode. Teksten redigeres i Admin → Notifikationer (udløser «Nulstilling af adgangskode»). */
export function sendResetEmail(user: User, token: string): Promise<boolean> {
  return accountEvents.passwordReset(user, resetUrl(token));
}
