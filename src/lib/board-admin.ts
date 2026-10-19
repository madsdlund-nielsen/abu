import { prisma } from "./db";
import { audit } from "./audit";
import { BookingError } from "./booking";
import { ensureLead, leadEligibleIds, NO_LEAD_ELIGIBLE_ERROR } from "./lead";
import { changeMeetingAdvisors } from "./meeting-admin";
import { subscriptionEvents } from "./notifications/service";
import { getPayments } from "./payments";
import { formatDkk, isFrequencyWeeks, monthlyPriceForBoard, planHandle, MAX_BOARD_SIZE, MIN_BOARD_SIZE } from "./pricing";
import { formatDate } from "./time";

export function diffBoard(before: string[], after: string[]) {
  const b = new Set(before);
  const a = new Set(after);
  return { added: after.filter((id) => !b.has(id)), removed: before.filter((id) => !a.has(id)), kept: after.filter((id) => b.has(id)) };
}

/** Parrer fjernede med tilføjede rådgivere (i rækkefølge). Resten er ekstra fjernelser eller tilføjelser. */
export function pairReplacements(removed: string[], added: string[]) {
  const n = Math.min(removed.length, added.length);
  return {
    pairs: removed.slice(0, n).map((out, i) => ({ out, in: added[i] })),
    extraRemoved: removed.slice(n),
    extraAdded: added.slice(n),
  };
}

export type PricePolicy = "keep" | "recalc";

export type BoardChangeResult =
  | { ok: true; message: string; conflicts: string[]; updatedMeetings: number }
  | { ok: false; error: string };

/**
 * Admin ændrer et fast board: rådgivere (2-4), valg af pris (behold / genberegn) og evt. kommende møder.
 * Nye rådgivere får deres aktuelle pris, de der bliver, beholder deres fastfrosne pris.
 */
export async function changeBoardAsAdmin(opts: {
  subscriptionId: string;
  advisorIds: string[];
  weeks: number;
  pricePolicy: PricePolicy;
  updateUpcoming: boolean;
  actorId: string;
  now?: Date;
}): Promise<BoardChangeResult> {
  const now = opts.now ?? new Date();
  const ids = [...new Set(opts.advisorIds)];
  if (ids.length < MIN_BOARD_SIZE || ids.length > MAX_BOARD_SIZE) return { ok: false, error: `Et board har ${MIN_BOARD_SIZE}-${MAX_BOARD_SIZE} rådgivere (nu ${ids.length}).` };
  if (!isFrequencyWeeks(opts.weeks)) return { ok: false, error: "Vælg en mødefrekvens." };
  const sub = await prisma.subscription.findUnique({ where: { id: opts.subscriptionId }, include: { advisors: true } });
  if (!sub) return { ok: false, error: "Abonnementet findes ikke." };
  if (sub.status === "CANCELLED") return { ok: false, error: "Abonnementet er opsagt." };
  if (opts.weeks !== sub.frequencyWeeks && opts.pricePolicy === "keep") {
    return { ok: false, error: "Frekvensen er ændret. Vælg «Genberegn prisen», eller behold frekvensen." };
  }

  const before = sub.advisors.map((a) => a.advisorId);
  const diff = diffBoard(before, ids);
  const profiles = await prisma.advisorProfile.findMany({ where: { userId: { in: ids } }, include: { user: { select: { name: true } } } });
  if (profiles.length !== ids.length) return { ok: false, error: "En af rådgiverne findes ikke." };
  const inactiveNew = profiles.find((p) => diff.added.includes(p.userId) && !p.active);
  if (inactiveNew) return { ok: false, error: `${inactiveNew.user.name} er ikke aktiv og kan ikke tilføjes.` };
  if ((await leadEligibleIds(ids)).size === 0) return { ok: false, error: `${NO_LEAD_ELIGIBLE_ERROR} Tilføj en rådgiver med tagget «Lead-kvalificeret».` };

  const frozen = new Map(sub.advisors.map((a) => [a.advisorId, a.pricePerMeetingDkk]));
  const prevLead = sub.advisors.find((a) => a.isLead)?.advisorId;
  // Den ansvarlige beholder rollen, hvis vedkommende bliver i boardet (ellers tildeles en ny nedenfor)
  const rows = ids.map((id) => ({ advisorId: id, isLead: id === prevLead, pricePerMeetingDkk: frozen.get(id) ?? profiles.find((p) => p.userId === id)!.pricePerMeetingDkk }));
  const monthly = opts.pricePolicy === "recalc" ? monthlyPriceForBoard(rows.map((r) => r.pricePerMeetingDkk), opts.weeks) : sub.monthlyPriceDkk;

  if ((monthly !== sub.monthlyPriceDkk || opts.weeks !== sub.frequencyWeeks) && (sub.status === "ACTIVE" || sub.status === "PAST_DUE")) {
    try {
      // Gælder fra næste betalingsperiode hos betalingsudbyderen
      await getPayments().changePlan(sub.providerSubscriptionId ?? sub.id, planHandle(opts.weeks), monthly);
    } catch (e) {
      console.error("[board] planskift hos betalingsudbyder fejlede", e);
      return { ok: false, error: "Prisen kunne ikke opdateres hos betalingsudbyderen. Intet er ændret." };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.subscriptionAdvisor.deleteMany({ where: { subscriptionId: sub.id } });
    await tx.subscription.update({
      where: { id: sub.id },
      data: { advisorCount: ids.length, frequencyWeeks: opts.weeks, monthlyPriceDkk: monthly, advisors: { create: rows } },
    });
  });

  // Ansvarlig rådgiver: den nuværende bliver, hvis vedkommende stadig er i boardet og kvalificeret – ellers ny tildeling
  const lead = await ensureLead(sub.id, "board_changed", opts.actorId);

  // Kommende møder
  const conflicts: string[] = [];
  let updated = 0;
  if (opts.updateUpcoming && (diff.added.length || diff.removed.length)) {
    const meetings = await prisma.meeting.findMany({
      where: { subscriptionId: sub.id, status: "BOOKED", startsAt: { gt: now } },
      include: { participants: true },
      orderBy: { startsAt: "asc" },
    });
    const { pairs, extraRemoved, extraAdded } = pairReplacements(diff.removed, diff.added);
    for (const m of meetings) {
      const inMeeting = new Set(m.participants.map((p) => p.userId));
      let changed = false;
      const attempt = async (removeId: string | undefined, addId: string | undefined) => {
        try {
          await changeMeetingAdvisors({ meetingId: m.id, actorId: opts.actorId, removeId, addId, note: "Fast board ændret af admin", silent: true, now });
          changed = true;
        } catch (e) {
          if (e instanceof BookingError) conflicts.push(`${formatDate(m.startsAt)}: ${e.message}`);
          else throw e;
        }
      };
      for (const p of pairs) if (inMeeting.has(p.out)) await attempt(p.out, p.in);
      for (const id of extraRemoved) if (inMeeting.has(id)) await attempt(id, undefined);
      for (const id of extraAdded) await attempt(undefined, id);
      if (changed) updated++;
    }
  }

  const priceNote = opts.pricePolicy === "recalc" ? `ny pris ${formatDkk(monthly)}/md.` : "uændret pris";
  await audit(
    opts.actorId,
    "subscription.admin_change_board",
    "Subscription",
    sub.id,
    `Tilføjet: ${diff.added.length}, fjernet: ${diff.removed.length}, ${priceNote}${opts.updateUpcoming ? `, kommende møder opdateret: ${updated}` : ""}`,
  );
  if (diff.added.length || diff.removed.length) {
    await subscriptionEvents.boardChanged(sub.id, { addedIds: diff.added, removedIds: diff.removed, upcomingUpdated: updated });
  }

  const parts = ["Boardet er opdateret.", opts.pricePolicy === "recalc" ? `Ny månedspris: ${formatDkk(monthly)} (gælder fra næste betalingsperiode).` : "Prisen er uændret."];
  if (opts.updateUpcoming) parts.push(`${updated === 1 ? "1 kommende møde er" : `${updated} kommende møder er`} opdateret${conflicts.length ? `, ${conflicts.length} konflikt${conflicts.length === 1 ? "" : "er"}` : ""}.`);
  if (lead.changed && lead.leadId) parts.push("Boardet har fået en ny ansvarlig rådgiver.");
  return { ok: true, message: parts.join(" "), conflicts, updatedMeetings: updated };
}
