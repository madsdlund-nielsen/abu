import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { getEnv } from "./env";
import { registerJobHandler } from "./jobs";
import { getStorage } from "./storage";
import { getTranscriber } from "./transcription";

/** Transskriberer en optagelse, laver resumé og gemmer på mødet. */
export async function transcribeRecording(recordingId: string) {
  const rec = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!rec) throw new Error("Optagelse findes ikke");
  if (!rec.storageKey) throw new Error("Optagelsen har ingen fil");

  await prisma.recording.update({ where: { id: rec.id }, data: { status: "TRANSCRIBING", error: null } });
  try {
    const storage = getStorage();
    const file = await storage.get(rec.storageKey);
    const transcriber = getTranscriber();
    const result = await transcriber.transcribe(file, rec.mime ?? "application/octet-stream", rec.storageKey.split("/").pop());
    const segmentsJson = result.segments as unknown as Prisma.InputJsonValue;
    const summary = await transcriber.summarize(result.text);

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
    await prisma.meeting.update({ where: { id: rec.meetingId }, data: { status: "COMPLETED" } });

    let deleteKey: string | null = null;
    if (getEnv().DELETE_RECORDINGS_AFTER_TRANSCRIPTION) {
      await storage.delete(rec.storageKey);
      deleteKey = rec.storageKey;
    }
    await prisma.recording.update({
      where: { id: rec.id },
      data: { status: "DONE", storageKey: deleteKey ? null : rec.storageKey },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.recording.update({ where: { id: rec.id }, data: { status: "FAILED", error: message.slice(0, 1000) } });
    throw e;
  }
}

registerJobHandler("transcribe_recording", async (payload) => {
  await transcribeRecording(String(payload.recordingId));
});
