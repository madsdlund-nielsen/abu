import { createHmac, timingSafeEqual } from "node:crypto";
import type { NotificationChannel } from "@prisma/client";
import { getEnv } from "../env";

function secret(): string {
  const env = getEnv();
  return env.APP_SECRET || `abu-unsubscribe:${env.DATABASE_URL}:${env.CRON_SECRET}`;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
/** 96 bit er rigeligt til et afmeldingslink og holder SMS-linket kort. */
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url").slice(0, 16);

export interface UnsubscribeClaim {
  channel: NotificationChannel;
  /** E-mailadresse (små bogstaver) eller telefonnummer i E.164 */
  address: string;
}

/** Signeret afmeldingstoken (stateless: ingen databaserække, intet udløb – afmelding skal altid virke). */
export function makeUnsubscribeToken(claim: UnsubscribeClaim): string {
  // SMS: kompakt "s<ciffer>" (kort link i en SMS). E-mail: base64url af adressen.
  const payload =
    claim.channel === "SMS" && /^\+\d{8,15}$/.test(claim.address) ? `s${claim.address.slice(1)}` : `e${b64(claim.address.toLowerCase())}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyUnsubscribeToken(token: string): UnsubscribeClaim | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (/^s\d{8,15}$/.test(payload)) return { channel: "SMS", address: `+${payload.slice(1)}` };
  if (payload.startsWith("e")) {
    const address = Buffer.from(payload.slice(1), "base64url").toString();
    return address.includes("@") ? { channel: "EMAIL", address } : null;
  }
  return null;
}

export function unsubscribeUrl(claim: UnsubscribeClaim): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/afmeld?t=${makeUnsubscribeToken(claim)}`;
}
