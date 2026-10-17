"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireRole, requireUser } from "@/lib/auth";
import { BookingError, bookMeeting, cancelMeeting } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { finalizeRecordingUpload, prepareRecordingUpload } from "@/lib/recording-upload";
import { redirectWith } from "@/lib/redirect";
import { getCustomerSubscription } from "@/lib/subscriptions";

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

/** Trin 1 af upload (H-5): giver et upload-mål. Selve filen sendes aldrig gennem en server action. */
export async function prepareRecordingUploadAction(meetingId: string, size: number) {
  const user = await requireRole("ADMIN", "ADVISOR");
  try {
    return await prepareRecordingUpload(user, String(meetingId), Number(size));
  } catch (e) {
    console.error("[upload] forberedelse fejlede", e instanceof Error ? e.message : e);
    return { ok: false as const, error: "Uploaden kunne ikke startes. Prøv igen." };
  }
}

/** Trin 2: tjekker filen i lageret (størrelse + magic bytes) og starter transskriptionen. */
export async function finalizeRecordingUploadAction(recordingId: string) {
  const user = await requireRole("ADMIN", "ADVISOR");
  const r = await finalizeRecordingUpload(user, String(recordingId));
  if (r.ok) revalidatePath(`/meetings/${r.meetingId}`);
  return r;
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
