"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { BookingError, cancelMeeting } from "@/lib/booking";
import { changeBoardAsAdmin } from "@/lib/board-admin";
import { changeMeetingAdvisors, rescheduleMeeting } from "@/lib/meeting-admin";
import type { ActionResult } from "@/lib/onboarding/cms-types";
import { redirectWith } from "@/lib/redirect";
import { parseDanishDateTime } from "@/lib/time";

type R = ActionResult<{ message: string }>;

async function run(meetingId: string, fn: (adminId: string) => Promise<string>): Promise<R> {
  const admin = await requireRole("ADMIN");
  try {
    const message = await fn(admin.id);
    revalidatePath(`/admin/meetings/${meetingId}`);
    revalidatePath(`/meetings/${meetingId}`);
    return { ok: true, message };
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    console.error("[admin-meeting] fejl", e);
    return { ok: false, error: "Ændringen kunne ikke gennemføres. Prøv igen." };
  }
}

const note = (v: string | undefined) => (v ?? "").trim().slice(0, 500);

export async function replaceAdvisorAction(meetingId: string, removeId: string, addId: string, noteText?: string): Promise<R> {
  return run(meetingId, async (adminId) => {
    const r = await changeMeetingAdvisors({ meetingId, actorId: adminId, removeId, addId, note: note(noteText) });
    return `${r.detail}. Kunden og de berørte rådgivere er underrettet.`;
  });
}

export async function addAdvisorAction(meetingId: string, addId: string, noteText?: string): Promise<R> {
  return run(meetingId, async (adminId) => {
    const r = await changeMeetingAdvisors({ meetingId, actorId: adminId, addId, note: note(noteText) });
    return `${r.detail}.`;
  });
}

export async function removeAdvisorAction(meetingId: string, removeId: string, noteText?: string): Promise<R> {
  return run(meetingId, async (adminId) => {
    const r = await changeMeetingAdvisors({ meetingId, actorId: adminId, removeId, note: note(noteText) });
    return `${r.detail}.${r.below ? " Bemærk: der er nu færre rådgivere i mødet end i kundens board." : ""}`;
  });
}

export async function rescheduleMeetingAction(meetingId: string, date: string, time: string, noteText?: string): Promise<R> {
  return run(meetingId, async (adminId) => {
    const startsAt = parseDanishDateTime(date, time);
    if (!startsAt) throw new BookingError("Angiv dato som dd.mm.åååå og et klokkeslæt.");
    const r = await rescheduleMeeting({ meetingId, actorId: adminId, startsAt, note: note(noteText) });
    return `${r.detail}. Deltagerne er underrettet, og påmindelserne er planlagt igen.`;
  });
}

export async function cancelOnBehalfAction(meetingId: string, noteText?: string): Promise<R> {
  return run(meetingId, async (adminId) => {
    const { freesQuota } = await cancelMeeting({ meetingId, actorId: adminId });
    await audit(adminId, "meeting.cancel_on_behalf", "Meeting", meetingId, note(noteText) || undefined);
    return freesQuota ? "Mødet er aflyst på kundens vegne, og kvoten er frigivet." : "Mødet er aflyst på kundens vegne. Det er under 48 timer før start, så det tæller som afholdt.";
  });
}

/** Fast board for et abonnement (admin): rådgivere, pris og evt. kommende møder. */
export async function adminChangeBoardAction(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const subscriptionId = String(formData.get("subscriptionId") ?? "");
  const back = `/admin/subscriptions/${subscriptionId}`;
  const r = await changeBoardAsAdmin({
    subscriptionId,
    advisorIds: formData.getAll("advisorIds").map(String),
    weeks: Number(formData.get("weeks")),
    pricePolicy: formData.get("pricePolicy") === "recalc" ? "recalc" : "keep",
    updateUpcoming: formData.get("updateUpcoming") === "on",
    actorId: admin.id,
  });
  if (!r.ok) redirectWith(back, "err", r.error);
  const conflicts = r.conflicts.length ? ` Konflikter (mødet er uændret): ${r.conflicts.join(" · ")}` : "";
  redirectWith(back, "ok", r.message + conflicts);
}
