import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { parseIncomingStop, parseStatusEvents } from "@/lib/messaging/inmobile";
import { applyDeliveryStatus, applyUnsubscribe } from "@/lib/notifications/service";
import { toE164 } from "@/lib/phone";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = getEnv().INMOBILE_WEBHOOK_SECRET;
  if (!secret) return false;
  const given = Buffer.from(new URL(req.url).searchParams.get("secret") ?? "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Statusrapporter (leveret/fejlet) og indgående SMS (STOP) fra inMobile. Formatet er et gæt og skal verificeres (se docs/OPEN_ITEMS.md).
 * Hemmeligheden sendes som ?secret=… i den URL, vi giver inMobile.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON" }, { status: 400 });
  }
  const events = parseStatusEvents(payload);
  const updated = events.length ? await applyDeliveryStatus(events) : 0;
  const stopFrom = parseIncomingStop(payload);
  if (stopFrom) {
    const phone = toE164(stopFrom);
    if (phone) {
      await applyUnsubscribe("SMS", phone);
      await prisma.auditLog.create({ data: { action: "notification.sms_stop", entity: "Notification", entityId: "SMS" } });
    }
  }
  return NextResponse.json({ updated, stop: Boolean(stopFrom) });
}
