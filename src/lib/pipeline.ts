import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { getEnv } from "./env";
import { statusAfterTranscription } from "./meeting-status";
import { registerJobHandler } from "./jobs";
import { detectMediaType, MEDIA_SNIFF_BYTES } from "./media-type";
import { getStorage } from "./storage";
import { meetingEvents } from "./notifications/service";
import { getTranscriber } from "./transcription";

/** Transskriberer en optagelse, laver resumé og gemmer på mødet. */
export async function transcribeRecording(recordingId: string) {
  const rec = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!rec) throw new Error("Optagelse findes ikke");
  if (!rec.storageKey) throw new Error("Optagelsen har ingen fil");

  await prisma.recording.update({ where: { id: rec.id }, data: { status: "TRANSCRIBING", error: null } });
  try {
    const storage = getStorage();
    const mime = rec.mime ?? "application/octet-stream";
    const type = detectMediaType(await storage.readHead(rec.storageKey, MEDIA_SNIFF_BYTES));
    // Filen læses fra disk/lager, mens den sendes – ikke ind i hukommelsen (H-5)
    const { blob, cleanup } = await storage.openBlob(rec.storageKey, type?.mime ?? mime);
    const transcriber = getTranscriber();
    let result;
    try {
      result = await transcriber.transcribe(blob, type?.mime ?? mime, `optagelse.${type?.ext ?? "bin"}`);
    } finally {
      await cleanup();
    }
    const segmentsJson = result.segments as unknown as Prisma.InputJsonValue;
    const summary = await transcriber.summarize(result.text);

    const hadTranscript = Boolean(await prisma.transcript.findUnique({ where: { meetingId: rec.meetingId }, select: { id: true } }));
    await prisma.transcript.upsert({
      where: { meetingId: rec.meetingId },
      create: {
        meetingId: rec.meetingId,
        text: result.text,
        segments: segmentsJson,
        summary,
        language: result.language,
      },
      update: { text: result.text, segments: segmentsJson, summary, language: result.language },
    });
    // Kun COMPLETED hvis mødet er slut; ellers klarer completePastMeetings det, når tiden er gået.
    const meeting = await prisma.meeting.findUnique({ where: { id: rec.meetingId }, select: { status: true, endsAt: true } });
    if (meeting) {
      const next = statusAfterTranscription(meeting, new Date());
      if (next !== meeting.status) await prisma.meeting.update({ where: { id: rec.meetingId }, data: { status: next } });
    }

    let deleteKey: string | null = null;
    if (getEnv().DELETE_RECORDINGS_AFTER_TRANSCRIPTION) {
      await storage.delete(rec.storageKey);
      deleteKey = rec.storageKey;
    }
    await prisma.recording.update({
      where: { id: rec.id },
      data: { status: "DONE", storageKey: deleteKey ? null : rec.storageKey },
    });
    if (!hadTranscript) await meetingEvents.transcriptReady(rec.meetingId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.recording.update({ where: { id: rec.id }, data: { status: "FAILED", error: message.slice(0, 1000) } });
    throw e;
  }
}

registerJobHandler("cleanup_stale_uploads", async () => {
  const { cleanupStaleUploads } = await import("./recording-upload");
  await cleanupStaleUploads();
});

registerJobHandler("transcribe_recording", async (payload) => {
  await transcribeRecording(String(payload.recordingId));
});
