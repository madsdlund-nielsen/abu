import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NotificationChannel } from "@prisma/client";
import { getEnv, isProductionEnv } from "../env";

/**
 * Signerede afmeldingslinks (M-8): fuld HMAC-SHA256 (256 bit) med APP_SECRET – ingen afledte nøgler – og udløb efter 1 år.
 * APP_SECRET kræves i produktion (opstarts-guarden). Lokalt uden APP_SECRET bruges en tilfældig nøgle pr. proces, så
 * links holder op med at virke ved genstart (aldrig en forudsigelig nøgle).
 */
export const UNSUBSCRIBE_TTL_DAYS = 365;

let ephemeral: string | null = null;
function secret(): string {
  const s = getEnv().APP_SECRET;
  if (s) return s;
  if (isProductionEnv()) throw new Error("APP_SECRET mangler (kræves til afmeldingslinks).");
  if (!ephemeral) {
    ephemeral = randomBytes(32).toString("base64url");
    console.warn("[afmelding] APP_SECRET er ikke sat – bruger en midlertidig nøgle; afmeldingslinks virker kun, til processen genstartes.");
  }
  return ephemeral;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string, key = secret()) => createHmac("sha256", key).update(`abu-unsubscribe:v1:${body}`).digest("base64url");

export interface UnsubscribeClaim {
  channel: NotificationChannel;
  /** E-mailadresse (små bogstaver) eller telefonnummer i E.164 */
  address: string;
}

/** `<payload>.<udløb, unix-sek. base36>.<HMAC-SHA256 base64url>` */
export function makeUnsubscribeToken(claim: UnsubscribeClaim, now = new Date(), ttlDays = UNSUBSCRIBE_TTL_DAYS): string {
  // SMS: kompakt "s<cifre>" (kort link i en SMS). E-mail: base64url af adressen.
  const payload =
    claim.channel === "SMS" && /^\+\d{8,15}$/.test(claim.address) ? `s${claim.address.slice(1)}` : `e${b64(claim.address.toLowerCase())}`;
  const exp = Math.floor(now.getTime() / 1000 + ttlDays * 86_400).toString(36);
  const body = `${payload}.${exp}`;
  return `${body}.${sign(body)}`;
}

export function verifyUnsubscribeToken(token: string, now = new Date()): UnsubscribeClaim | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [payload, exp, sig] = parts;
  if (!payload || !/^[0-9a-z]{1,10}$/.test(exp) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
  const expected = Buffer.from(sign(`${payload}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (parseInt(exp, 36) * 1000 < now.getTime()) return null;
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
