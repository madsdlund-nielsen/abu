"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canAccessMeeting } from "@/lib/access";
import { audit } from "@/lib/audit";
import { requireRole, requireUser } from "@/lib/auth";
import { BookingError, bookMeeting, cancelMeeting } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { recordingUploadDecision } from "@/lib/meeting-status";
import { enqueueJob } from "@/lib/jobs";
import { redirectWith } from "@/lib/redirect";
import { getStorage } from "@/lib/storage";
import { getCustomerSubscription } from "@/lib/subscriptions";
import { randomToken } from "@/lib/tokens";

export async function bookAction(formData: FormData) {
  const user = await requireRole("CUSTOMER");
  const sub = await getCustomerSubscription(user.id);
  if (!sub || sub.status !== "ACTIVE") redirectWith("/book", "err", "Du skal have et aktivt abonnement for at booke.");
  const startsAt = new Date(String(formData.get("startsAt") ?? ""));
  if (Number.isNaN(startsAt.getTime())) redirectWith("/book", "err", "Ugyldigt tidspunkt.");

  let id: string;
  try {
    id = (await bookMeeting({ subscriptionId: sub.id, startsAt, actorId: user.id })).id;
  } catch (e) {
    if (e instanceof BookingError) redirectWith("/book", "err", e.message);
    throw e;
  }
  redirectWith(`/meetings/${id}`, "ok", "Mødet er booket. Vi har sendt en bekræftelse på e-mail.");
}

export async function cancelMeetingAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("meetingId") ?? "");
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { subscription: true },
  });
  if (!meeting) redirectWith("/meetings", "err", "Mødet findes ikke.");
  if (user.role !== "ADMIN" && meeting.subscription.customerId !== user.id) {
    redirectWith("/meetings", "err", "Du kan ikke aflyse dette møde.");
  }
  try {
    const { freesQuota } = await cancelMeeting({ meetingId: id, actorId: user.id });
    redirectWith(
      `/meetings/${id}`,
      "ok",
      freesQuota
        ? "Mødet er aflyst. Du kan booke et nyt."
        : "Mødet er aflyst. Da det er mindre end 48 timer før start, tæller det som afholdt.",
    );
  } catch (e) {
    if (e instanceof BookingError) redirectWith(`/meetings/${id}`, "err", e.message);
    throw e;
  }
}

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export async function uploadRecordingAction(formData: FormData) {
  const user = await requireRole("ADMIN", "ADVISOR");
  const meetingId = String(formData.get("meetingId") ?? "");
  const back = `/meetings/${meetingId}`;
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, include: { participants: true } });
  if (!meeting || !canAccessMeeting(user, meeting.participants.map((p) => p.userId))) {
    redirectWith("/meetings", "err", "Mødet findes ikke.");
  }
  const decision = recordingUploadDecision(meeting, new Date());
  if (!decision.allowed) redirectWith(back, "err", decision.reason);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirectWith(back, "err", "Vælg en lyd- eller videofil.");
  if (file.size > MAX_UPLOAD_BYTES) redirectWith(back, "err", "Filen er for stor (maks 500 MB).");
  const mime = file.type || "application/octet-stream";
  if (!/^(audio|video)\//.test(mime) && mime !== "application/octet-stream") {
    redirectWith(back, "err", "Kun lyd- og videofiler kan uploades.");
  }

  const ext = (file.name.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  const key = `recordings/${meetingId}/${randomToken(8)}.${ext}`;
  await getStorage().put(key, Buffer.from(await file.arrayBuffer()), mime);
  const rec = await prisma.recording.create({
    data: { meetingId, storageKey: key, mime, source: "UPLOAD" },
  });
  await enqueueJob("transcribe_recording", { recordingId: rec.id });
  await audit(user.id, "recording.upload", "Recording", rec.id);
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent("Optagelsen er uploadet og transskriberes nu. Opdater siden om lidt.")}`);
}

export async function retryRecordingAction(formData: FormData) {
  const user = await requireRole("ADMIN");
  const id = String(formData.get("recordingId") ?? "");
  const rec = await prisma.recording.findUnique({ where: { id } });
  if (!rec) redirectWith("/admin/meetings", "err", "Optagelsen findes ikke.");
  await prisma.recording.update({ where: { id }, data: { status: "RECEIVED", error: null } });
  await enqueueJob("transcribe_recording", { recordingId: id });
  await audit(user.id, "recording.retry", "Recording", id);
  redirectWith(`/meetings/${rec.meetingId}`, "ok", "Transskription er sat i gang igen.");
}
