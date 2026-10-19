import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withSystemContext } from "@/lib/db-context";
import { enqueueJob } from "@/lib/jobs";
import { getVideo } from "@/lib/video";
import { readLimitedText } from "@/lib/webhooks/signature";

export const dynamic = "force-dynamic";

/** Videoudbyderen melder at en optagelse er færdig -> Recording + transskriptions-job. */
export async function POST(req: Request) {
  const video = getVideo();
  if (video.name === "mock") return NextResponse.json({ error: "Webhook ikke aktiv" }, { status: 404 });

  const raw = await readLimitedText(req);
  if (raw === null) return NextResponse.json({ error: "For stor" }, { status: 413 });
  let evt;
  try {
    evt = video.parseWebhook(raw, req.headers);
  } catch {
    return NextResponse.json({ error: "Ugyldig signatur" }, { status: 401 });
  }
  if (!evt) return NextResponse.json({ result: "ignored" });

  // RLS: først efter verificeret signatur – webhooken har ingen bruger (systemkontekst)
  const outcome = await withSystemContext("webhooks.video", async () => {
    const externalId = `video:${evt.providerMeetingId}:${evt.storageKey}`;
    try {
      await prisma.webhookEvent.create({ data: { provider: video.name, externalId, payload: JSON.parse(raw) }, select: { id: true } });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") return "duplicate" as const;
      throw e;
    }
    const meeting = await prisma.meeting.findFirst({ where: { providerMeetingId: evt.providerMeetingId } });
    if (!meeting) return "unknown meeting" as const;

    const rec = await prisma.recording.create({
      data: { meetingId: meeting.id, storageKey: evt.storageKey, mime: evt.mime, source: "WEBHOOK" },
    });
    await prisma.webhookEvent.update({ where: { externalId }, data: { processedAt: new Date() }, select: { id: true } });
    await enqueueJob("transcribe_recording", { recordingId: rec.id });
    return "queued" as const;
  });
  if (outcome !== "queued") return NextResponse.json({ result: outcome });
  return NextResponse.json({ result: "queued" });
}
