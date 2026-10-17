import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { verifyFrisbiiSignature } from "@/lib/payments/frisbii-signature";
import { processFrisbiiEvent, type FrisbiiEvent } from "@/lib/payments/webhook";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const env = getEnv();
  if (env.PAYMENT_PROVIDER !== "frisbii") return NextResponse.json({ error: "Webhook ikke aktiv" }, { status: 404 });

  let body: FrisbiiEvent;
  try {
    body = (await req.json()) as FrisbiiEvent;
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON" }, { status: 400 });
  }
  if (!verifyFrisbiiSignature(body, env.FRISBII_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Ugyldig signatur" }, { status: 401 });
  }
  const result = await processFrisbiiEvent(body);
  return NextResponse.json({ result });
}
