import { timingSafeEqual } from "node:crypto";
import { prisma } from "../db";
import { toE164 } from "../phone";

/**
 * Hærdning af inMobile-webhooken (M-7). inMobiles dokumentation for signerede webhooks er ikke verificeret endnu, så:
 *  - hemmeligheden accepteres i headeren `x-webhook-secret` (holder den ude af URL'er og proxy-logs) eller som ?secret=,
 *  - to hemmeligheder accepteres under rotation (nuværende + forrige),
 *  - kun kendte beskeder opdateres, og STOP accepteres kun fra numre, vi faktisk kender.
 */
export const MAX_STATUS_EVENTS = 100;
const KNOWN_NUMBER_DAYS = 180;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function authorizeInmobileWebhook(url: string, headers: Headers, secrets: string[]): boolean {
  const valid = secrets.filter((s) => s.length > 0);
  if (!valid.length) return false;
  const given = headers.get("x-webhook-secret") ?? new URL(url).searchParams.get("secret") ?? "";
  if (!given) return false;
  // Sammenlign mod alle (ingen tidlig afbrydelse, der afslører hvilken)
  return valid.map((s) => safeEqual(given, s)).some(Boolean);
}

/** Er nummeret et, vi kender (bruger, samtykke eller modtager af en SMS fra os inden for 180 dage)? */
export async function isKnownSmsNumber(e164: string, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - KNOWN_NUMBER_DAYS * 86_400_000);
  const sent = await prisma.notificationLog.count({ where: { channel: "SMS", recipientAddress: e164, createdAt: { gte: since } } });
  if (sent > 0) return true;
  const [users, consents] = await Promise.all([
    prisma.user.findMany({ where: { phone: { not: null } }, select: { phone: true } }),
    prisma.marketingConsent.findMany({ where: { phone: { not: null } }, select: { phone: true } }),
  ]);
  return [...users, ...consents].some((r) => toE164(r.phone) === e164);
}
