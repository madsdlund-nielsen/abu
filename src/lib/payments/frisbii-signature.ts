import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Frisbii/Reepay webhook-signatur: hex(HMAC-SHA256(timestamp + id, webhookSecret)).
 * `timestamp` og `id` er felter i webhook-bodyen.
 */
export function computeFrisbiiSignature(timestamp: string, id: string, secret: string): string {
  return createHmac("sha256", secret).update(timestamp + id).digest("hex");
}

export function verifyFrisbiiSignature(
  body: { id?: unknown; timestamp?: unknown; signature?: unknown },
  secret: string,
): boolean {
  if (!secret) return false;
  const { id, timestamp, signature } = body;
  if (typeof id !== "string" || typeof timestamp !== "string" || typeof signature !== "string") {
    return false;
  }
  const expected = Buffer.from(computeFrisbiiSignature(timestamp, id, secret), "utf8");
  const given = Buffer.from(signature, "utf8");
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
