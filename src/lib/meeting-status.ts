import type { MeetingStatus } from "@prisma/client";
import { prisma } from "./db";

/**
 * Møder i disse statusser optager rådgiverens kalender. COMPLETED medregnes, så et møde, der (fejlagtigt eller
 * tidligt) er markeret som afholdt, ikke frigiver rådgiveren til en dobbeltbooking.
 */
export const ADVISOR_BLOCKING_STATUSES: MeetingStatus[] = ["BOOKED", "COMPLETED"];

/** Det mindste, beslutningslogikken har brug for om et møde. */
export interface MeetingTimes {
  status: MeetingStatus;
  startsAt: Date;
  endsAt: Date;
}

export const UPLOAD_BEFORE_START_ERROR =
  "Optagelser kan først uploades, når mødet er startet. Mødet ligger endnu ude i fremtiden.";

/** Må der uploades en optagelse nu? Kun for møder, der er begyndt og ikke er aflyst. */
export function recordingUploadDecision(
  meeting: Pick<MeetingTimes, "status" | "startsAt">,
  now: Date,
): { allowed: true } | { allowed: false; reason: string } {
  if (meeting.status === "CANCELLED") return { allowed: false, reason: "Mødet er aflyst, så der kan ikke uploades en optagelse." };
  if (meeting.startsAt > now) return { allowed: false, reason: UPLOAD_BEFORE_START_ERROR };
  return { allowed: true };
}

/** Skal et møde nu markeres som afholdt? Kun BOOKED møder, hvis sluttidspunkt er passeret. */
export function shouldMarkCompleted(meeting: Pick<MeetingTimes, "status" | "endsAt">, now: Date): boolean {
  return meeting.status === "BOOKED" && meeting.endsAt <= now;
}

/** Status efter at transskriptionen er færdig: aldrig COMPLETED før mødet er slut. */
export function statusAfterTranscription(meeting: Pick<MeetingTimes, "status" | "endsAt">, now: Date): MeetingStatus {
  return shouldMarkCompleted(meeting, now) ? "COMPLETED" : meeting.status;
}

/**
 * Idempotent trin: markerer BOOKED møder, hvis sluttidspunkt er passeret, som COMPLETED.
 * Kan køres så ofte det skal være (jobprocessor, cron, side-visninger).
 */
export async function completePastMeetings(now = new Date()): Promise<number> {
  const res = await prisma.meeting.updateMany({
    where: { status: "BOOKED", endsAt: { lte: now } },
    data: { status: "COMPLETED" },
  });
  return res.count;
}
