import { NextResponse } from "next/server";
import { getPayments } from "@/lib/payments";
import { paymentEventSchema, processFrisbiiEvent } from "@/lib/payments/webhook";
import { readLimitedText } from "@/lib/webhooks/signature";

export const dynamic = "force-dynamic";

/**
 * Betalingswebhook (H-4): signaturen verificeres over den RÅ body og et højst 5 minutter gammelt tidsstempel, FØR
 * body'en parses. Idempotens via begivenhedens id (WebhookEvent.externalId).
 */
export async function POST(req: Request) {
  const payments = getPayments();
  if (payments.name === "mock") return NextResponse.json({ error: "Webhook ikke aktiv" }, { status: 404 });

  const raw = await readLimitedText(req);
  if (raw === null) return NextResponse.json({ error: "For stor" }, { status: 413 });
  const verified = payments.verifyWebhook(raw, req.headers);
  if (!verified.ok) {
    console.warn(`[webhook:payments] afvist (${verified.reason})`);
    return NextResponse.json({ error: "Ugyldig signatur" }, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON" }, { status: 400 });
  }
  const evt = paymentEventSchema.safeParse(json);
  if (!evt.success) return NextResponse.json({ error: "Ukendt format" }, { status: 400 });
  const result = await processFrisbiiEvent(evt.data);
  return NextResponse.json({ result });
}
