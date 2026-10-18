import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { withSystemContext } from "@/lib/db-context";
import { getClientIp } from "@/lib/client-ip";
import { getEnv } from "@/lib/env";
import { parseIncomingStop, parseStatusEvents } from "@/lib/messaging/inmobile";
import { authorizeInmobileWebhook, isKnownSmsNumber, MAX_STATUS_EVENTS } from "@/lib/messaging/inmobile-webhook";
import { maskPhone } from "@/lib/messaging/redact";
import { applyDeliveryStatus, applyUnsubscribe } from "@/lib/notifications/service";
import { toE164 } from "@/lib/phone";
import { rateLimitIp } from "@/lib/rate-limit";
import { readLimitedText } from "@/lib/webhooks/signature";

export const dynamic = "force-dynamic";

/**
 * Statusrapporter (leveret/fejlet) og indgående SMS (STOP) fra inMobile. Formatet er et gæt og skal verificeres (se
 * docs/OPEN_ITEMS.md). Hemmeligheden sendes helst i headeren x-webhook-secret, ellers som ?secret=… (M-7).
 */
export async function POST(req: Request) {
  const env = getEnv();
  if (!authorizeInmobileWebhook(req.url, req.headers, [env.INMOBILE_WEBHOOK_SECRET, env.INMOBILE_WEBHOOK_SECRET_PREVIOUS])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await rateLimitIp("inmobile-webhook", await getClientIp(), 600, 60_000))) return NextResponse.json({ error: "For mange" }, { status: 429 });
  const raw = await readLimitedText(req, 64 * 1024);
  if (raw === null) return NextResponse.json({ error: "For stor" }, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON" }, { status: 400 });
  }
  // Kun kendte beskeder (vores id eller udbyderens id på en sendt besked) kan opdateres
  // RLS: først efter godkendt hemmelighed – statusrapporter og STOP har ingen bruger (systemkontekst)
  const { updated, stopped } = await withSystemContext("webhooks.inmobile", async () => {
    const events = parseStatusEvents(payload).slice(0, MAX_STATUS_EVENTS);
    const updated = events.length ? await applyDeliveryStatus(events) : 0;
    const stopFrom = parseIncomingStop(payload);
    let stopped = false;
    if (stopFrom) {
      const phone = toE164(stopFrom);
      if (phone && (await isKnownSmsNumber(phone))) {
        await applyUnsubscribe("SMS", phone);
        await audit(null, "notification.sms_stop", "Notification", "SMS", maskPhone(phone));
        stopped = true;
      } else {
        console.warn(`[webhook:inmobile] STOP fra ukendt nummer ignoreret (${phone ? maskPhone(phone) : "ugyldigt"})`);
      }
    }
    return { updated, stopped };
  });
  return NextResponse.json({ updated, stop: stopped });
}
