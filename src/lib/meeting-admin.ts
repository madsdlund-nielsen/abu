import { prisma } from "./db";
import { audit } from "./audit";
import { getEnv } from "./env";
import { BookingError, loadAvailability } from "./booking";
import { meetingEvents } from "./notifications/service";
import { DEFAULTS, explainSlotConflict, isSlotFreeForAll } from "./slots";
import { rankSubstituteCandidates, type RankedCandidate, type SubstituteCandidate } from "./substitutes";
import { getVideo } from "./video";
import { formatDateTime } from "./time";

/** Fejl, når en ren fjernelse ville give færre rådgivere end boardet (ejerens beslutning: møder holdes altid med hele boardet). */
export const WHOLE_BOARD_ERROR = "Et møde holdes altid med hele boardet – udskift rådgiveren i stedet.";

/**
 * Møder planlægges altid for hele boardet – aldrig 1:1 eller med et reduceret board (ejerens beslutning 18.10.2026).
 * Udskiftning (fjern + tilføj i samme handling) er altid tilladt, og admin må tilføje en ekstra deltager ud over boardet.
 * En ren fjernelse er kun tilladt for en ekstra deltager, altså så længe mødet stadig har mindst boardets størrelse.
 * Returnerer en dansk fejl eller null.
 */
export function meetingAdvisorChangeError(i: { current: number; boardSize: number; remove: boolean; add: boolean }): string | null {
  if (!i.remove && !i.add) return "Vælg, hvad der skal ændres.";
  if (i.remove && !i.add && i.current - 1 < Math.max(1, i.boardSize)) return WHOLE_BOARD_ERROR;
  return null;
}

/** Kan rådgiveren fjernes uden udskiftning? Kun en ekstra deltager ud over boardet. */
export function canRemoveWithoutReplacement(current: number, boardSize: number): boolean {
  return meetingAdvisorChangeError({ current, boardSize, remove: true, add: false }) === null;
}

function durationMinutes(m: { startsAt: Date; endsAt: Date }): number {
  return Math.round((m.endsAt.getTime() - m.startsAt.getTime()) / 60_000);
}

async function loadMeetingForAdmin(meetingId: string) {
  return prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { participants: { include: { user: true } }, subscription: { include: { customer: true, advisors: true } } },
  });
}

/** Rådgivere, der kan overtage en plads i mødet, med ledighed og match. Sorteret (a) ledig, (b) tag-match, (c) pris. */
export async function listSubstituteCandidates(meetingId: string): Promise<RankedCandidate[]> {
  const meeting = await loadMeetingForAdmin(meetingId);
  if (!meeting) return [];
  const current = new Set(meeting.participants.map((p) => p.userId));
  const [profiles, profile] = await Promise.all([
    // Inaktive rådgivere vises også, men markeret «Inaktiv» og kan ikke vælges (QA #13)
    prisma.advisorProfile.findMany({ where: { userId: { notIn: [...current] } }, include: { user: true, tags: true } }),
    prisma.customerProfile.findUnique({ where: { userId: meeting.subscription.customerId }, select: { testAnswers: true } }),
  ]);
  const ids = profiles.map((p) => p.userId);
  const margin = DEFAULTS.bufferMinutes;
  const availability = await loadAvailability(
    prisma,
    ids,
    new Date(meeting.startsAt.getTime() - margin * 60_000),
    new Date(meeting.endsAt.getTime() + margin * 60_000),
    meeting.id,
  );
  const dur = durationMinutes(meeting);
  const candidates: SubstituteCandidate[] = profiles.map((p) => {
    const av = availability.find((a) => a.id === p.userId)!;
    const conflict = p.active ? explainSlotConflict(av, meeting.startsAt, dur) : "Inaktiv";
    return { id: p.userId, name: p.user.name, title: p.title, priceDkk: p.pricePerMeetingDkk, tagIds: p.tags.map((t) => t.tagId), available: p.active && conflict === null, conflict, ...(p.active ? {} : { inactive: true }) };
  });
  const needsList = (profile?.testAnswers as { needs?: { tagId: string; weight: number }[] } | null)?.needs ?? [];
  const needs = Object.fromEntries(needsList.map((n) => [n.tagId, n.weight]));
  return rankSubstituteCandidates(candidates, needs);
}

interface ChangeOpts {
  meetingId: string;
  actorId: string;
  note?: string;
}

async function lockFor(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], keys: string[]) {
  for (const key of [...new Set(keys)].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/**
 * Udskifter, tilføjer eller fjerner rådgivere i ét møde. Mødet har altid mindst hele boardet (se
 * `meetingAdvisorChangeError`): en ren fjernelse afvises, medmindre rådgiveren er en ekstra deltager. Ledigheden tjekkes med samme logik og låsning som booking, i en
 * transaktion. Kundens pris er uændret (abonnementet dækker); honoraret registreres pr. faktisk deltager (MeetingParticipant).
 */
export async function changeMeetingAdvisors(opts: ChangeOpts & { removeId?: string; addId?: string; now?: Date; silent?: boolean }) {
  const now = opts.now ?? new Date();
  const { removeId, addId } = opts;
  if (!removeId && !addId) throw new BookingError("Vælg, hvad der skal ændres.");

  const result = await prisma.$transaction(
    async (tx) => {
      const m = await tx.meeting.findUnique({ where: { id: opts.meetingId }, include: { participants: true, subscription: true } });
      if (!m) throw new BookingError("Mødet findes ikke.");
      if (m.status !== "BOOKED") throw new BookingError("Kun bookede møder kan ændres.");
      if (m.endsAt <= now) throw new BookingError("Mødet er allerede slut.");
      await lockFor(tx, [`meeting:${m.id}`, ...(addId ? [`adv:${addId}`] : [])]);

      const fresh = await tx.meetingParticipant.findMany({ where: { meetingId: m.id }, include: { user: { select: { role: true, name: true } } } });
      const advisors = fresh.filter((p) => p.user.role === "ADVISOR");
      if (removeId && !advisors.some((p) => p.userId === removeId)) throw new BookingError("Rådgiveren deltager ikke i mødet.");
      const remaining = advisors.length - (removeId ? 1 : 0) + (addId ? 1 : 0);
      const ruleError = meetingAdvisorChangeError({ current: advisors.length, boardSize: m.subscription.advisorCount, remove: Boolean(removeId), add: Boolean(addId) });
      if (ruleError) throw new BookingError(ruleError);

      let addedName = "";
      let addedPrice: number | null = null;
      if (addId) {
        if (fresh.some((p) => p.userId === addId)) throw new BookingError("Rådgiveren deltager allerede i mødet.");
        const profile = await tx.advisorProfile.findUnique({ where: { userId: addId }, include: { user: true } });
        if (!profile || !profile.active) throw new BookingError("Rådgiveren er ikke aktiv.");
        const margin = DEFAULTS.bufferMinutes * 60_000;
        const [av] = await loadAvailability(tx, [addId], new Date(m.startsAt.getTime() - margin), new Date(m.endsAt.getTime() + margin), m.id);
        if (!isSlotFreeForAll([av], m.startsAt, durationMinutes(m), DEFAULTS.bufferMinutes)) {
          throw new BookingError(`${profile.user.name} er ikke ledig på mødets tidspunkt (${explainSlotConflict(av, m.startsAt, durationMinutes(m)) ?? "optaget"}).`);
        }
        addedName = profile.user.name;
        addedPrice = profile.pricePerMeetingDkk;
      }
      const removedName = removeId ? (advisors.find((p) => p.userId === removeId)?.user.name ?? "") : "";
      if (removeId) await tx.meetingParticipant.delete({ where: { meetingId_userId: { meetingId: m.id, userId: removeId } } });
      if (addId) await tx.meetingParticipant.create({ data: { meetingId: m.id, userId: addId, pricePerMeetingDkk: addedPrice } });
      return { meeting: m, addedName, removedName, remaining, boardSize: m.subscription.advisorCount };
    },
    { timeout: 15_000 },
  );

  // Værtsadgang til det eksisterende rum (mock/Whereby: rummet genbruges)
  const host = await getVideo().grantHostAccess(result.meeting.providerMeetingId, result.meeting.hostRoomUrl).catch(() => null);
  if (host?.hostRoomUrl && host.hostRoomUrl !== result.meeting.hostRoomUrl) {
    await prisma.meeting.update({ where: { id: opts.meetingId }, data: { hostRoomUrl: host.hostRoomUrl } });
  }

  const what = removeId && addId ? `Udskiftet ${result.removedName} med ${result.addedName}` : addId ? `Tilføjet ${result.addedName}` : `Fjernet ${result.removedName}`;
  const detail = [what, opts.note?.trim() ? `Note: ${opts.note.trim()}` : ""].filter(Boolean).join(". ");
  await audit(opts.actorId, removeId && addId ? "meeting.replace_advisor" : addId ? "meeting.add_advisor" : "meeting.remove_advisor", "Meeting", opts.meetingId, detail);
  if (!opts.silent) await meetingEvents.participantsChanged(opts.meetingId, { addedIds: addId ? [addId] : [], removedIds: removeId ? [removeId] : [] });
  return { ...result, below: result.remaining < result.boardSize, detail };
}

/** Flytter et møde til et nyt tidspunkt, hvis alle rådgivere er ledige (samme tjek og låsning som booking). */
export async function rescheduleMeeting(opts: ChangeOpts & { startsAt: Date; now?: Date }) {
  const now = opts.now ?? new Date();
  const duration = getEnv().MEETING_DURATION_MINUTES;
  if (opts.startsAt <= now) throw new BookingError("Det nye tidspunkt skal ligge i fremtiden.");
  const endsAt = new Date(opts.startsAt.getTime() + duration * 60_000);

  const before = await prisma.$transaction(
    async (tx) => {
      const m = await tx.meeting.findUnique({ where: { id: opts.meetingId }, include: { participants: { include: { user: { select: { role: true } } } } } });
      if (!m) throw new BookingError("Mødet findes ikke.");
      if (m.status !== "BOOKED") throw new BookingError("Kun bookede møder kan flyttes.");
      const advisorIds = m.participants.filter((p) => p.user.role === "ADVISOR").map((p) => p.userId);
      await lockFor(tx, [`meeting:${m.id}`, ...advisorIds.map((id) => `adv:${id}`)]);
      const margin = DEFAULTS.bufferMinutes * 60_000;
      const availability = await loadAvailability(tx, advisorIds, new Date(opts.startsAt.getTime() - margin), new Date(endsAt.getTime() + margin), m.id);
      const busy = availability.find((a) => explainSlotConflict(a, opts.startsAt, duration) !== null);
      if (busy) {
        const name = (await tx.user.findUnique({ where: { id: busy.id }, select: { name: true } }))?.name ?? "En rådgiver";
        throw new BookingError(`${name} er ikke ledig på det nye tidspunkt (${explainSlotConflict(busy, opts.startsAt, duration)}).`);
      }
      await tx.meeting.update({ where: { id: m.id }, data: { startsAt: opts.startsAt, endsAt } });
      return m;
    },
    { timeout: 15_000 },
  );

  // Nyt videorum (rummene har faste start-/slutdatoer hos Whereby); mock genskaber blot URL'en
  try {
    const room = await getVideo().createMeeting({ startsAt: opts.startsAt, endsAt, title: "Advisory Board Unlimited" });
    await prisma.meeting.update({ where: { id: opts.meetingId }, data: { roomUrl: room.roomUrl, hostRoomUrl: room.hostRoomUrl, providerMeetingId: room.providerMeetingId } });
    if (before.providerMeetingId) await getVideo().deleteMeeting(before.providerMeetingId).catch((e) => console.error("[meeting] kunne ikke slette gammelt rum", e));
  } catch (e) {
    console.error("[meeting] nyt videorum kunne ikke oprettes – beholder det gamle", e);
  }

  const detail = [`Flyttet fra ${formatDateTime(before.startsAt)} til ${formatDateTime(opts.startsAt)}`, opts.note?.trim() ? `Note: ${opts.note.trim()}` : ""].filter(Boolean).join(". ");
  await audit(opts.actorId, "meeting.reschedule", "Meeting", opts.meetingId, detail);
  await meetingEvents.rescheduled(opts.meetingId);
  return { detail };
}

export interface MeetingBelowBoard {
  id: string;
  startsAt: Date;
  companyName: string;
  advisors: number;
  boardSize: number;
}

/**
 * Kommende møder med færre rådgivere end kundens board (fx efter GDPR-sletning af en rådgiver, eller hvis kunden har
 * udvidet boardet efter bookingen). Vises som advarselsliste på admin-forsiden, så admin kan udskifte/tilføje.
 */
export async function meetingsBelowBoard(now = new Date()): Promise<MeetingBelowBoard[]> {
  const rows = await prisma.meeting.findMany({
    where: { status: "BOOKED", endsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      startsAt: true,
      subscription: { select: { advisorCount: true, customer: { select: { companyName: true } } } },
      participants: { select: { user: { select: { role: true } } } },
    },
  });
  return rows
    .map((m) => ({
      id: m.id,
      startsAt: m.startsAt,
      companyName: m.subscription.customer.companyName,
      advisors: m.participants.filter((p) => p.user.role === "ADVISOR").length,
      boardSize: m.subscription.advisorCount,
    }))
    .filter((m) => m.advisors < m.boardSize);
}
