import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { getEnv } from "./env";
import { meetingEvents } from "./notifications/service";
import { canBookAt, quotaState } from "./quota";
import { bookingWindow, computeSlots, DEFAULTS, isSlotFreeForAll, type AdvisorAvailability } from "./slots";
import { getVideo } from "./video";
import { audit } from "./audit";
import { ADVISOR_BLOCKING_STATUSES } from "./meeting-status";
import { cancellationFreesQuota } from "./quota";

export class BookingError extends Error {}

type Tx = Prisma.TransactionClient | typeof prisma;

export async function loadAvailability(tx: Tx, advisorIds: string[], from: Date, to: Date, excludeMeetingId?: string): Promise<AdvisorAvailability[]> {
  const margin = 24 * 3_600_000;
  const [rules, blocks, meetings] = await Promise.all([
    tx.availabilityRule.findMany({ where: { advisorId: { in: advisorIds } } }),
    tx.availabilityBlock.findMany({
      where: { advisorId: { in: advisorIds }, endsAt: { gt: from }, startsAt: { lt: to } },
    }),
    tx.meetingParticipant.findMany({
      where: {
        userId: { in: advisorIds },
        meeting: { ...(excludeMeetingId ? { id: { not: excludeMeetingId } } : {}), status: { in: ADVISOR_BLOCKING_STATUSES }, endsAt: { gt: new Date(from.getTime() - margin) }, startsAt: { lt: new Date(to.getTime() + margin) } },
      },
      select: { userId: true, meeting: { select: { startsAt: true, endsAt: true } } },
    }),
  ]);
  return advisorIds.map((id) => ({
    id,
    rules: rules.filter((r) => r.advisorId === id),
    blocks: blocks.filter((b) => b.advisorId === id),
    meetings: meetings.filter((m) => m.userId === id).map((m) => m.meeting),
  }));
}

async function loadSubscription(tx: Tx, subscriptionId: string) {
  return tx.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      advisors: { include: { advisor: { select: { active: true, userId: true } } } },
      meetings: { select: { startsAt: true, status: true, cancelledAt: true } },
    },
  });
}

/** Alle bookbare starttidspunkter for et abonnement (kvote + rådgivertilgængelighed). */
export async function getBookableSlots(subscriptionId: string, now = new Date()): Promise<Date[]> {
  const sub = await loadSubscription(prisma, subscriptionId);
  if (!sub || sub.status !== "ACTIVE" || !sub.startedAt) return [];
  const advisorIds = sub.advisors.map((a) => a.advisorId);
  if (sub.advisors.some((a) => !a.advisor.active)) return [];
  const duration = getEnv().MEETING_DURATION_MINUTES;
  const { earliest, latest } = bookingWindow({ now });
  const availability = await loadAvailability(prisma, advisorIds, earliest, latest);
  const slots = computeSlots(availability, { now, durationMinutes: duration });
  const startedAt = sub.startedAt;
  return slots.filter((s) => canBookAt(startedAt, sub.frequencyWeeks, sub.meetings, s, now));
}

export async function getQuotaInfo(subscriptionId: string, now = new Date()) {
  const sub = await loadSubscription(prisma, subscriptionId);
  if (!sub?.startedAt) return null;
  return quotaState(sub.startedAt, sub.frequencyWeeks, sub.meetings, now);
}

/**
 * Booker et møde. Alt valideres igen i en transaktion med advisory locks, så to samtidige
 * bookinger af samme rådgiver ikke kan overlappe.
 */
export async function bookMeeting(opts: { subscriptionId: string; startsAt: Date; actorId: string; now?: Date }) {
  const now = opts.now ?? new Date();
  const duration = getEnv().MEETING_DURATION_MINUTES;
  const endsAt = new Date(opts.startsAt.getTime() + duration * 60_000);

  const meeting = await prisma.$transaction(
    async (tx) => {
      const sub = await loadSubscription(tx, opts.subscriptionId);
      if (!sub) throw new BookingError("Abonnementet findes ikke.");
      if (sub.status !== "ACTIVE" || !sub.startedAt) throw new BookingError("Abonnementet er ikke aktivt.");
      const advisorIds = sub.advisors.map((a) => a.advisorId).sort();
      if (advisorIds.length === 0) throw new BookingError("Der er ingen rådgivere på abonnementet.");
      if (sub.advisors.some((a) => !a.advisor.active)) throw new BookingError("En af rådgiverne er ikke længere aktiv.");

      // Lås abonnement og rådgivere i fast rækkefølge (undgår deadlocks)
      for (const key of [`sub:${sub.id}`, ...advisorIds.map((id) => `adv:${id}`)]) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      }

      // Genindlæs efter låsene, så vi ser andres committede bookinger
      const fresh = await loadSubscription(tx, opts.subscriptionId);
      if (!fresh?.startedAt) throw new BookingError("Abonnementet er ikke aktivt.");
      const { earliest, latest } = bookingWindow({ now });
      if (opts.startsAt < earliest || opts.startsAt > latest) {
        throw new BookingError("Tidspunktet ligger uden for det bookbare vindue (2 dage – 16 uger frem).");
      }
      if (!canBookAt(fresh.startedAt, fresh.frequencyWeeks, fresh.meetings, opts.startsAt, now)) {
        throw new BookingError("Du har allerede brugt dit møde for den periode, eller perioden er endnu ikke åben.");
      }
      const availability = await loadAvailability(tx, advisorIds, opts.startsAt, endsAt);
      if (!isSlotFreeForAll(availability, opts.startsAt, duration, DEFAULTS.bufferMinutes)) {
        throw new BookingError("Tidspunktet er desværre ikke længere ledigt. Vælg et andet.");
      }

      return tx.meeting.create({
        data: {
          subscriptionId: sub.id,
          startsAt: opts.startsAt,
          endsAt,
          createdById: opts.actorId,
          participants: {
            create: [
              { userId: sub.customerId },
              // Rådgiverens pris for netop dette møde gemmes, så afregning kan følge de faktiske deltagere
              ...advisorIds.map((userId) => ({ userId, pricePerMeetingDkk: sub.advisors.find((a) => a.advisorId === userId)?.pricePerMeetingDkk })),
            ],
          },
        },
      });
    },
    { timeout: 15_000 },
  );

  // Videorum oprettes uden for transaktionen (ekstern HTTP). Fejler det, rulles bookingen tilbage.
  try {
    const room = await getVideo().createMeeting({
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      title: "Advisory Board Unlimited",
    });
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { roomUrl: room.roomUrl, hostRoomUrl: room.hostRoomUrl, providerMeetingId: room.providerMeetingId },
    });
  } catch (e) {
    await prisma.meeting.delete({ where: { id: meeting.id } });
    console.error("[booking] videorum kunne ikke oprettes", e);
    throw new BookingError("Videorummet kunne ikke oprettes. Prøv igen om lidt.");
  }

  await audit(opts.actorId, "meeting.book", "Meeting", meeting.id);
  await meetingEvents.booked(meeting.id);
  return meeting;
}

/** Aflys et møde. Aflysning ≥ 48 t før start frigiver kvoten; senere tæller den som brugt. */
export async function cancelMeeting(opts: { meetingId: string; actorId: string; now?: Date }) {
  const now = opts.now ?? new Date();
  const meeting = await prisma.meeting.findUnique({ where: { id: opts.meetingId } });
  if (!meeting) throw new BookingError("Mødet findes ikke.");
  if (meeting.status !== "BOOKED") throw new BookingError("Mødet kan ikke aflyses.");
  if (meeting.startsAt <= now) throw new BookingError("Mødet er allerede startet.");

  await prisma.meeting.update({ where: { id: meeting.id }, data: { status: "CANCELLED", cancelledAt: now } });
  if (meeting.providerMeetingId) {
    await getVideo()
      .deleteMeeting(meeting.providerMeetingId)
      .catch((e) => console.error("[booking] kunne ikke slette videorum", e));
  }
  await audit(opts.actorId, "meeting.cancel", "Meeting", meeting.id);
  await meetingEvents.cancelled(meeting.id);
  return { freesQuota: cancellationFreesQuota(meeting.startsAt, now) };
}
