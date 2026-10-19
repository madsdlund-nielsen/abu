import type { Prisma } from "@prisma/client";
import { audit } from "./audit";
import { prisma } from "./db";
import { currentPrincipal, DbContextError } from "./db-context";
import { userDirectory } from "./user-directory";

/**
 * Ansvarlig rådgiver (lead) pr. board (ejerens beslutning 18.10.2026).
 *
 *  - Hvert board i PENDING/ACTIVE/PAST_DUE har præcis én ansvarlig rådgiver, og vedkommende har systemtagget
 *    «Lead-kvalificeret» (admin-tag, `systemKey = "lead"`) og er aktiv.
 *  - Et board skal indeholde mindst én rådgiver, der kan være ansvarlig (matching, board-builder og server-validering).
 *  - Tildeling: blandt boardets kvalificerede rådgivere den med færrest ansvarsroller lige nu; lige → færrest pladser i
 *    boards i alt → laveste pris → navn. Under en advisory lock, så to samtidige køb ikke giver samme skæve fordeling.
 *  - Forlader den ansvarlige boardet (board-ændring, deaktivering, sletning) eller mister tagget, tildeles en ny
 *    automatisk. Er der ingen kvalificeret tilbage, vises boardet for admin («Boards uden ansvarlig rådgiver»).
 *  - Udligning omfordeler kun efter admins bekræftelse (`proposeBalancing` + `applyBalancing`).
 */

export const LEAD_TAG_KEY = "lead";
export const LEAD_TAG_NAME = "Lead-kvalificeret";
export const LIVE_STATUSES = ["PENDING", "ACTIVE", "PAST_DUE"] as const;
export const NO_LEAD_ELIGIBLE_ERROR = "Boardet skal have mindst én rådgiver, der kan være ansvarlig rådgiver.";

type Db = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------------------------------------ Rene funktioner

export interface LeadCandidate {
  id: string;
  name: string;
  priceDkk: number;
  /** Antal boards (PENDING/ACTIVE/PAST_DUE), hvor rådgiveren er ansvarlig nu – ekskl. det board, der tildeles */
  leadCount: number;
  /** Antal pladser i boards i alt (samme statusser) */
  seatCount: number;
}

export function compareLeadCandidates(a: LeadCandidate, b: LeadCandidate): number {
  return a.leadCount - b.leadCount || a.seatCount - b.seatCount || a.priceDkk - b.priceDkk || a.name.localeCompare(b.name, "da") || a.id.localeCompare(b.id);
}

/** Vælg den ansvarlige blandt boardets kvalificerede rådgivere. null, hvis ingen er kvalificeret. */
export function pickLead(candidates: readonly LeadCandidate[]): string | null {
  return [...candidates].sort(compareLeadCandidates)[0]?.id ?? null;
}

export interface BalanceBoard {
  subscriptionId: string;
  /** Visningsnavn (kundens virksomhed) */
  label: string;
  leadId: string | null;
  /** Boardets kvalificerede, aktive rådgivere */
  eligibleIds: string[];
}

export interface BalanceMove {
  subscriptionId: string;
  label: string;
  from: string;
  to: string;
}

export function leadCounts(boards: readonly BalanceBoard[], advisorIds: readonly string[] = []): Map<string, number> {
  const counts = new Map<string, number>(advisorIds.map((id) => [id, 0]));
  for (const b of boards) for (const id of b.eligibleIds) if (!counts.has(id)) counts.set(id, 0);
  for (const b of boards) if (b.leadId) counts.set(b.leadId, (counts.get(b.leadId) ?? 0) + 1);
  return counts;
}

/** max – min af antal ansvarsroller blandt de rådgivere, der kan få en (kvalificeret på mindst ét board). */
export function leadSpread(counts: Map<string, number>): number {
  const v = [...counts.values()];
  return v.length ? Math.max(...v) - Math.min(...v) : 0;
}

/**
 * Forslag til udligning: et lille sæt flytninger (hver inden for boardets egne kvalificerede rådgivere), der mindsker
 * forskellen mellem flest og færrest ansvarsroller. Grådigt: flyt fra den mest belastede til den mindst belastede, så
 * længe forskellen mellem de to er mindst 2 (ellers bliver det ikke bedre). Hvert board flyttes højst én gang.
 * Boards uden ansvarlig rådgiver indgår ikke (de håndteres af den automatiske tildeling).
 */
export function proposeBalancing(boards: readonly BalanceBoard[]): BalanceMove[] {
  const counts = leadCounts(boards);
  const moves: BalanceMove[] = [];
  const moved = new Set<string>();
  for (;;) {
    let best: { board: BalanceBoard; to: string; gain: number } | null = null;
    for (const b of boards) {
      if (!b.leadId || moved.has(b.subscriptionId)) continue;
      const from = counts.get(b.leadId) ?? 0;
      for (const to of b.eligibleIds) {
        if (to === b.leadId) continue;
        const gain = from - (counts.get(to) ?? 0);
        if (gain < 2) continue;
        if (
          !best ||
          gain > best.gain ||
          (gain === best.gain && (b.label.localeCompare(best.board.label, "da") < 0 || (b.label === best.board.label && to < best.to)))
        ) {
          best = { board: b, to, gain };
        }
      }
    }
    if (!best) break;
    const from = best.board.leadId!;
    moves.push({ subscriptionId: best.board.subscriptionId, label: best.board.label, from, to: best.to });
    moved.add(best.board.subscriptionId);
    counts.set(from, (counts.get(from) ?? 0) - 1);
    counts.set(best.to, (counts.get(best.to) ?? 0) + 1);
  }
  return moves;
}

// ------------------------------------------------------------------------------------------------ Database

/** Id på systemtagget «Lead-kvalificeret». Oprettes, hvis det mangler (migrationen opretter det normalt). */
export async function getLeadTagId(db: Db = prisma): Promise<string> {
  const t = await db.tag.findUnique({ where: { systemKey: LEAD_TAG_KEY }, select: { id: true } });
  if (t) return t.id;
  // Admin-tagget er kun synligt for admin/system (RLS). Ser en anden kontekst det ikke, er det ikke et manglende tag –
  // opret det ikke (N-1: en admin-side, der renderedes uden ADMIN-principal, endte her med en RLS-fejl).
  const role = (await currentPrincipal())?.role;
  if (role !== "ADMIN" && role !== "system") throw new DbContextError(`Lead-tagget er kun synligt for admin/system (kontekst: ${role ?? "ingen"}).`);
  const created = await db.tag.upsert({
    where: { slug: "lead-kvalificeret" },
    update: { kind: "ADMIN", systemKey: LEAD_TAG_KEY, active: true },
    create: { slug: "lead-kvalificeret", name: LEAD_TAG_NAME, kind: "ADMIN", systemKey: LEAD_TAG_KEY, sortOrder: 1000, description: "Kan være ansvarlig rådgiver for et board. Internt – vises aldrig for kunder." },
    select: { id: true },
  });
  return created.id;
}

/**
 * Hvilke af rådgiverne kan være ansvarlige (lead-tag og aktive)? RLS: lead-tagget er et internt admin-tag, som kun
 * admin/system kan se – booleanen beregnes derfor af `rls.lead_eligible_ids` (SECURITY DEFINER), som kun returnerer id'erne.
 */
export async function leadEligibleIds(advisorIds: readonly string[], db: Db = prisma): Promise<Set<string>> {
  if (advisorIds.length === 0) return new Set();
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM rls.lead_eligible_ids(${[...advisorIds]}::text[]) AS id`;
  return new Set(rows.map((r) => r.id));
}

/** Alle aktive rådgivere med lead-tagget. */
export async function allLeadEligibleIds(db: Db = prisma): Promise<Set<string>> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM rls.lead_eligible_ids(NULL::text[]) AS id`;
  return new Set(rows.map((r) => r.id));
}

async function lockLeadAssignment(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('lead-assignment'))`;
}

export interface LeadAssignment {
  leadId: string | null;
  previousLeadId: string | null;
  changed: boolean;
}

/**
 * Sikrer, at abonnementet har en gyldig ansvarlig rådgiver (i en transaktion). `keep` (standard): en gyldig nuværende
 * ansvarlig beholdes. Ellers vælges med `pickLead`. Ingen kvalificeret → ingen ansvarlig (vises for admin).
 */
export async function assignLeadTx(tx: Prisma.TransactionClient, subscriptionId: string, opts: { keep?: boolean } = {}): Promise<LeadAssignment> {
  await lockLeadAssignment(tx);
  const rows = await tx.subscriptionAdvisor.findMany({ where: { subscriptionId }, select: { advisorId: true, isLead: true, pricePerMeetingDkk: true } });
  const previousLeadId = rows.find((r) => r.isLead)?.advisorId ?? null;
  const eligible = await leadEligibleIds(rows.map((r) => r.advisorId), tx);
  if ((opts.keep ?? true) && previousLeadId && eligible.has(previousLeadId)) return { leadId: previousLeadId, previousLeadId, changed: false };

  const ids = rows.filter((r) => eligible.has(r.advisorId)).map((r) => r.advisorId);
  // RLS: kunden ser ikke andre kunders boards. Fordelingen (antal ansvarsroller/pladser i levende boards, ekskl. dette)
  // kommer fra `rls.advisor_lead_load`, som kun returnerer tallene for netop boardets rådgivere; navnene fra kataloget.
  const [load, names] = await Promise.all([
    ids.length
      ? tx.$queryRaw<{ advisor_id: string; lead_count: number; seat_count: number }[]>`SELECT advisor_id, lead_count, seat_count FROM rls.advisor_lead_load(${ids}::text[], ${subscriptionId})`
      : Promise.resolve([]),
    userDirectory(ids, tx),
  ]);
  const count = (id: string, key: "lead_count" | "seat_count") => Number(load.find((r) => r.advisor_id === id)?.[key] ?? 0);
  const leadId = pickLead(
    rows
      .filter((r) => eligible.has(r.advisorId))
      .map((r) => ({ id: r.advisorId, name: names.get(r.advisorId)?.name ?? "", priceDkk: r.pricePerMeetingDkk, leadCount: count(r.advisorId, "lead_count"), seatCount: count(r.advisorId, "seat_count") })),
  );
  if (leadId === previousLeadId) return { leadId, previousLeadId, changed: false };
  await tx.subscriptionAdvisor.updateMany({ where: { subscriptionId, isLead: true }, data: { isLead: false } });
  if (leadId) await tx.subscriptionAdvisor.update({ where: { subscriptionId_advisorId: { subscriptionId, advisorId: leadId } }, data: { isLead: true } });
  return { leadId, previousLeadId, changed: true };
}

export type LeadReason = "created" | "board_changed" | "deactivated" | "deleted" | "tag_removed" | "manual" | "balancing";

const REASON_LABEL: Record<LeadReason, string> = {
  created: "nyt abonnement",
  board_changed: "boardet er ændret",
  deactivated: "rådgiveren er deaktiveret",
  deleted: "rådgiveren er slettet",
  tag_removed: "rådgiveren har mistet lead-tagget",
  manual: "valgt af admin",
  balancing: "udligning",
};

/** Efter en ændring: audit + besked (ikke ved oprettelse – kunden har ikke haft en ansvarlig før). */
export async function afterLeadChange(subscriptionId: string, a: LeadAssignment, reason: LeadReason, actorId: string | null): Promise<void> {
  if (!a.changed) return;
  await audit(actorId, reason === "manual" ? "subscription.lead.set" : reason === "balancing" ? "subscription.lead.balance" : "subscription.lead.auto", "Subscription", subscriptionId, `${a.leadId ? "Ny ansvarlig" : "Ingen kvalificeret ansvarlig"} (${REASON_LABEL[reason]})`);
  if (reason === "created" || !a.leadId) return;
  const { subscriptionEvents } = await import("./notifications/service");
  await subscriptionEvents.leadChanged(subscriptionId, { leadId: a.leadId, previousLeadId: a.previousLeadId });
}

/** Sikrer en gyldig ansvarlig for ét abonnement (egen transaktion). */
export async function ensureLead(subscriptionId: string, reason: LeadReason, actorId: string | null = null): Promise<LeadAssignment> {
  const a = await prisma.$transaction((tx) => assignLeadTx(tx, subscriptionId), { timeout: 15_000 });
  await afterLeadChange(subscriptionId, a, reason, actorId);
  return a;
}

/** Efter deaktivering eller fjernet lead-tag: nye ansvarlige for de boards, hvor rådgiveren var ansvarlig. */
export async function reassignLeadsFrom(advisorId: string, reason: LeadReason, actorId: string | null = null): Promise<number> {
  const subs = await prisma.subscriptionAdvisor.findMany({ where: { advisorId, isLead: true, subscription: { status: { in: [...LIVE_STATUSES] } } }, select: { subscriptionId: true } });
  let n = 0;
  for (const s of subs) if ((await ensureLead(s.subscriptionId, reason, actorId)).changed) n++;
  return n;
}

/** Når en rådgiver bliver kvalificeret (aktiveret eller får lead-tagget): giv boards uden ansvarlig, hvor vedkommende sidder, en. */
export async function fillMissingLeads(advisorId: string, actorId: string | null = null): Promise<number> {
  const subs = await prisma.subscriptionAdvisor.findMany({
    where: { advisorId, subscription: { status: { in: [...LIVE_STATUSES] }, advisors: { none: { isLead: true } } } },
    select: { subscriptionId: true },
  });
  let n = 0;
  for (const s of subs) if ((await ensureLead(s.subscriptionId, "board_changed", actorId)).changed) n++;
  return n;
}

/** Admin vælger den ansvarlige manuelt (kun kvalificerede medlemmer af boardet). */
export async function setLeadManually(actorId: string, subscriptionId: string, advisorId: string): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const r = await prisma.$transaction(async (tx) => {
    await lockLeadAssignment(tx);
    const rows = await tx.subscriptionAdvisor.findMany({ where: { subscriptionId }, select: { advisorId: true, isLead: true } });
    if (!rows.some((x) => x.advisorId === advisorId)) return { error: "Rådgiveren sidder ikke i boardet." };
    if (!(await leadEligibleIds([advisorId], tx)).has(advisorId)) return { error: "Rådgiveren kan ikke være ansvarlig (mangler lead-tagget eller er inaktiv)." };
    const previousLeadId = rows.find((x) => x.isLead)?.advisorId ?? null;
    if (previousLeadId === advisorId) return { a: { leadId: advisorId, previousLeadId, changed: false } };
    await tx.subscriptionAdvisor.updateMany({ where: { subscriptionId, isLead: true }, data: { isLead: false } });
    await tx.subscriptionAdvisor.update({ where: { subscriptionId_advisorId: { subscriptionId, advisorId } }, data: { isLead: true } });
    return { a: { leadId: advisorId, previousLeadId, changed: true } };
  });
  if ("error" in r) return { ok: false, error: r.error! };
  await afterLeadChange(subscriptionId, r.a, "manual", actorId);
  return { ok: true, changed: r.a.changed };
}

export interface LeadOverview {
  advisors: { id: string; name: string; leadCount: number; seatCount: number; active: boolean }[];
  boards: (BalanceBoard & { status: string; leadName: string | null })[];
  withoutLead: { subscriptionId: string; label: string; status: string; hasEligible: boolean }[];
}

/** Fordeling af ansvarsroller (admin-oversigt). */
export async function loadLeadOverview(db: Db = prisma): Promise<LeadOverview> {
  const tagId = await getLeadTagId(db);
  const [eligibleProfiles, subs] = await Promise.all([
    db.advisorProfile.findMany({ where: { tags: { some: { tagId } } }, select: { userId: true, active: true, user: { select: { name: true } } } }),
    db.subscription.findMany({
      where: { status: { in: [...LIVE_STATUSES] } },
      select: { id: true, status: true, customer: { select: { companyName: true } }, advisors: { select: { advisorId: true, isLead: true, advisor: { select: { active: true, user: { select: { name: true } }, tags: { where: { tagId }, select: { tagId: true } } } } } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const boards = subs.map((s) => {
    const lead = s.advisors.find((a) => a.isLead) ?? null;
    return {
      subscriptionId: s.id,
      label: s.customer.companyName,
      status: s.status,
      leadId: lead?.advisorId ?? null,
      leadName: lead?.advisor.user.name ?? null,
      eligibleIds: s.advisors.filter((a) => a.advisor.active && a.advisor.tags.length > 0).map((a) => a.advisorId),
    };
  });
  const seat = new Map<string, number>();
  for (const s of subs) for (const a of s.advisors) seat.set(a.advisorId, (seat.get(a.advisorId) ?? 0) + 1);
  const counts = leadCounts(boards);
  return {
    advisors: eligibleProfiles
      .map((p) => ({ id: p.userId, name: p.user.name, active: p.active, leadCount: counts.get(p.userId) ?? 0, seatCount: seat.get(p.userId) ?? 0 }))
      .sort((a, b) => b.leadCount - a.leadCount || a.name.localeCompare(b.name, "da")),
    boards,
    withoutLead: boards.filter((b) => !b.leadId).map((b) => ({ subscriptionId: b.subscriptionId, label: b.label, status: b.status, hasEligible: b.eligibleIds.length > 0 })),
  };
}

/**
 * Anvender et udligningsforslag efter admins bekræftelse. Hver flytning tjekkes igen (den ansvarlige er stadig `from`,
 * og `to` er stadig et kvalificeret medlem); forældede flytninger springes over.
 */
export async function applyBalancing(actorId: string, moves: readonly { subscriptionId: string; from: string; to: string }[]): Promise<{ applied: number; skipped: number }> {
  let applied = 0;
  let skipped = 0;
  for (const m of moves) {
    const r = await prisma.$transaction(async (tx) => {
      await lockLeadAssignment(tx);
      const rows = await tx.subscriptionAdvisor.findMany({ where: { subscriptionId: m.subscriptionId }, select: { advisorId: true, isLead: true } });
      const current = rows.find((x) => x.isLead)?.advisorId ?? null;
      if (current !== m.from || !rows.some((x) => x.advisorId === m.to)) return null;
      if (!(await leadEligibleIds([m.to], tx)).has(m.to)) return null;
      await tx.subscriptionAdvisor.updateMany({ where: { subscriptionId: m.subscriptionId, isLead: true }, data: { isLead: false } });
      await tx.subscriptionAdvisor.update({ where: { subscriptionId_advisorId: { subscriptionId: m.subscriptionId, advisorId: m.to } }, data: { isLead: true } });
      return { leadId: m.to, previousLeadId: m.from, changed: true };
    });
    if (!r) {
      skipped++;
      continue;
    }
    applied++;
    await afterLeadChange(m.subscriptionId, r, "balancing", actorId);
  }
  return { applied, skipped };
}
