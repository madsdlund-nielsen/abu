import type { MeetingStatus } from "@prisma/client";
import { getEnv } from "./env";

/**
 * Hvor mødesiden står i forhold til "deltag":
 *  - not_open_yet: før vinduet åbner (nedtælling / «Åbner kl. HH:MM»)
 *  - open: fra `earlyMinutes` før start til mødets slut
 *  - ended: efter slut, eller mødet er markeret som afholdt
 *  - cancelled: mødet er aflyst (uanset tidspunkt)
 */
export type MeetingJoinState = "not_open_yet" | "open" | "ended" | "cancelled";

export interface JoinMeeting {
  status: MeetingStatus;
  startsAt: Date;
  endsAt: Date;
}

export const DEFAULT_JOIN_EARLY_MINUTES = 15;

/** Tidspunktet hvor "deltag" åbner. Regnes på tidspunkter (ikke klokkeslæt), så sommertid ikke gør en forskel. */
export function joinOpensAt(meeting: Pick<JoinMeeting, "startsAt">, earlyMinutes: number = joinEarlyMinutes()): Date {
  return new Date(meeting.startsAt.getTime() - earlyMinutes * 60_000);
}

export function joinEarlyMinutes(): number {
  return getEnv().MEETING_JOIN_EARLY_MINUTES;
}

/** Ren funktion: er mødet åbent for deltagelse nu? */
export function meetingJoinState(meeting: JoinMeeting, now: Date, earlyMinutes: number = joinEarlyMinutes()): MeetingJoinState {
  if (meeting.status === "CANCELLED") return "cancelled";
  if (meeting.status === "COMPLETED" || now >= meeting.endsAt) return "ended";
  if (now < joinOpensAt(meeting, earlyMinutes)) return "not_open_yet";
  return "open";
}
