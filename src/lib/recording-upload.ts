import type { Role } from "@prisma/client";
import { canAccessMeeting } from "./access";
import { audit } from "./audit";
import { prisma } from "./db";
import { enqueueJob } from "./jobs";
import { detectMediaType, MAX_RECORDING_BYTES, MEDIA_SNIFF_BYTES } from "./media-type";
import { recordingUploadDecision } from "./meeting-status";
import { getStorage } from "./storage";
import { randomToken } from "./tokens";

/**
 * Upload af optagelser (H-5). Filen går aldrig gennem en server action:
 *  1. prepare: serveren opretter en Recording (UPLOADING) og giver et upload-mål:
 *     S3 → presigned POST direkte fra browseren til lageret (størrelse håndhæves af lageret),
 *     lokalt → PUT til /api/uploads/recordings/<id>, som streames til disk.
 *  2. finalize: serveren tjekker størrelse og magic bytes i lageret, sætter MIME ud fra indholdet og starter transskription.
 * Antallet af samtidige uploads er begrænset pr. bruger og i alt.
 */
export const MAX_PENDING_PER_USER = 2;
export const MAX_PENDING_TOTAL = 10;
/** Så længe et upload-mål er gyldigt; ufærdige uploads ryddes op efter et døgn. */
export const UPLOAD_TTL_SECONDS = 60 * 60;
const STALE_UPLOAD_MS = 24 * 3_600_000;

type Actor = { id: string; role: Role };
export type UploadTarget = { kind: "s3"; url: string; fields: Record<string, string> } | { kind: "server"; url: string };
type Fail = { ok: false; error: string };

export async function prepareRecordingUpload(user: Actor, meetingId: string, size: number, now = new Date()): Promise<{ ok: true; recordingId: string; target: UploadTarget } | Fail> {
  if (user.role !== "ADMIN" && user.role !== "ADVISOR") return { ok: false, error: "Kun rådgivere og administratorer kan uploade." };
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, include: { participants: { select: { userId: true } } } });
  if (!meeting || !canAccessMeeting(user, meeting.participants.map((p) => p.userId))) return { ok: false, error: "Mødet findes ikke." };
  const decision = recordingUploadDecision(meeting, now);
  if (!decision.allowed) return { ok: false, error: decision.reason };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "Vælg en lyd- eller videofil." };
  if (size > MAX_RECORDING_BYTES) return { ok: false, error: "Filen er for stor (maks 500 MB)." };

  const since = new Date(now.getTime() - UPLOAD_TTL_SECONDS * 1000);
  const [mine, total] = await Promise.all([
    prisma.recording.count({ where: { status: "UPLOADING", uploadedById: user.id, createdAt: { gt: since } } }),
    prisma.recording.count({ where: { status: "UPLOADING", createdAt: { gt: since } } }),
  ]);
  if (mine >= MAX_PENDING_PER_USER || total >= MAX_PENDING_TOTAL) return { ok: false, error: "Der er allerede uploads i gang. Vent til de er færdige, og prøv igen." };

  const storage = getStorage();
  const key = `recordings/${meetingId}/${randomToken(12)}`;
  const rec = await prisma.recording.create({ data: { meetingId, storageKey: key, source: "UPLOAD", status: "UPLOADING", uploadedById: user.id } });
  if (storage.createDirectUpload) {
    const { url, fields } = await storage.createDirectUpload(key, { maxBytes: MAX_RECORDING_BYTES, expiresSeconds: UPLOAD_TTL_SECONDS });
    return { ok: true, recordingId: rec.id, target: { kind: "s3", url, fields } };
  }
  return { ok: true, recordingId: rec.id, target: { kind: "server", url: `/api/uploads/recordings/${rec.id}` } };
}

/** Den igangværende upload, hvis den tilhører brugeren og stadig er gyldig. */
export async function findPendingUpload(userId: string, recordingId: string, now = new Date()) {
  const rec = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!rec || rec.status !== "UPLOADING" || rec.uploadedById !== userId || !rec.storageKey) return null;
  if (now.getTime() - rec.createdAt.getTime() > UPLOAD_TTL_SECONDS * 1000) return null;
  return rec;
}

export async function finalizeRecordingUpload(user: Actor, recordingId: string, now = new Date()): Promise<{ ok: true; meetingId: string } | Fail> {
  const rec = await findPendingUpload(user.id, recordingId, now);
  if (!rec?.storageKey) return { ok: false, error: "Uploaden blev ikke fundet eller er udløbet. Prøv igen." };
  const storage = getStorage();
  const discard = async (error: string): Promise<Fail> => {
    await storage.delete(rec.storageKey!).catch(() => {});
    await prisma.recording.delete({ where: { id: rec.id } }).catch(() => {});
    return { ok: false, error };
  };
  const st = await storage.stat(rec.storageKey);
  if (!st || st.size === 0) return discard("Filen nåede ikke frem. Prøv igen.");
  if (st.size > MAX_RECORDING_BYTES) return discard("Filen er for stor (maks 500 MB).");
  const type = detectMediaType(await storage.readHead(rec.storageKey, MEDIA_SNIFF_BYTES));
  if (!type) return discard("Filen er ikke en lyd- eller videofil, vi kan transskribere.");
  await prisma.recording.update({ where: { id: rec.id }, data: { status: "RECEIVED", mime: type.mime, sizeBytes: st.size } });
  await enqueueJob("transcribe_recording", { recordingId: rec.id });
  await audit(user.id, "recording.upload", "Recording", rec.id, `${type.label}, ${Math.round(st.size / 1024 / 1024)} MB`);
  return { ok: true, meetingId: rec.meetingId };
}

/** Rydder op i uploads, der aldrig blev afsluttet (objekt + række). */
export async function cleanupStaleUploads(now = new Date()): Promise<number> {
  const stale = await prisma.recording.findMany({ where: { status: "UPLOADING", createdAt: { lt: new Date(now.getTime() - STALE_UPLOAD_MS) } }, take: 200 });
  const storage = getStorage();
  for (const r of stale) {
    if (r.storageKey) await storage.delete(r.storageKey).catch(() => {});
    await prisma.recording.delete({ where: { id: r.id } }).catch(() => {});
  }
  return stale.length;
}

/** Højst så mange streams skrives samtidig af denne proces (lokal upload-rute). */
export const MAX_CONCURRENT_STREAMS = 2;
let activeStreams = 0;
export function tryAcquireStreamSlot(): (() => void) | null {
  if (activeStreams >= MAX_CONCURRENT_STREAMS) return null;
  activeStreams++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      activeStreams--;
    }
  };
}
