import type { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { prisma } from "../db";
import { cookieSecure } from "../env";
import { randomToken, sha256 } from "../tokens";
import type { CompanyInfo } from "../cvr/types";
import type { MatchResult } from "../matching";

export const ONBOARDING_COOKIE = "abu_onb";
export const ONBOARDING_DAYS = 7;
export const TOTAL_STEPS = 6;

export interface CompanyState {
  cvr: string;
  phone: string;
  /** Opslagsresultat (verificeret) eller undefined, hvis opslaget fejlede */
  info?: CompanyInfo;
  lookup: "ok" | "ceased" | "not_found" | "error";
  lookupMessage?: string;
  /** Den gratis kvote hos opslagstjenesten er opbrugt */
  quota?: boolean;
  /** Manuelt indtastet (ikke verificeret) */
  manual?: { name: string; address: string };
  /** Kunden har bekræftet virksomheden (trin 3) */
  confirmed: boolean;
}

export interface SessionData {
  contact?: { name: string; email: string };
  company?: CompanyState;
  board?: { advisorIds: string[]; weeks: number | null };
}

export type SessionAnswers = Record<string, string[]>;
export type SuggestedBoard = (MatchResult & { computedAt: string }) | Record<string, unknown>;

export type Suggestion = MatchResult & { computedAt: string };
export function asSuggestion(s: SuggestedBoard): Suggestion | null {
  return "needs" in s && "advisorIds" in s ? (s as Suggestion) : null;
}

export interface OnboardingState {
  id: string;
  step: number;
  /** Lead oprettet i trin 1 */
  leadId: string | null;
  /** Har personen et aktivt markedsføringssamtykke (trin 1)? */
  marketingConsent: boolean;
  data: SessionData;
  answers: SessionAnswers;
  suggested: SuggestedBoard;
}

type SessionRow = {
  id: string;
  step: number;
  leadId: string | null;
  data: unknown;
  answers: unknown;
  suggestedBoard: unknown;
  lead?: { consents: { emailConsent: boolean; smsConsent: boolean; emailWithdrawnAt: Date | null; smsWithdrawnAt: Date | null }[] } | null;
};

function toState(row: SessionRow): OnboardingState {
  return {
    id: row.id,
    step: row.step,
    leadId: row.leadId,
    marketingConsent: Boolean(row.lead?.consents.some((c) => (c.emailConsent && !c.emailWithdrawnAt) || (c.smsConsent && !c.smsWithdrawnAt))),
    data: (row.data ?? {}) as SessionData,
    answers: (row.answers ?? {}) as SessionAnswers,
    suggested: (row.suggestedBoard ?? {}) as SuggestedBoard,
  };
}

export async function getOnboardingSession(): Promise<OnboardingState | null> {
  const jar = await cookies();
  const token = jar.get(ONBOARDING_COOKIE)?.value;
  if (!token) return null;
  const row = await prisma.onboardingSession.findUnique({ where: { tokenHash: sha256(token) }, include: { lead: { include: { consents: true } } } });
  if (!row) return null;
  if (row.expiresAt < new Date()) {
    await prisma.onboardingSession.delete({ where: { id: row.id } }).catch(() => {});
    return null;
  }
  return toState(row);
}

/** Opretter en ny session og sætter cookien. Kun fra server actions / route handlers. */
export async function createOnboardingSession(init: { step: number; data: SessionData; leadId?: string | null }): Promise<OnboardingState> {
  await cleanupExpiredOnboarding();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ONBOARDING_DAYS * 86_400_000);
  const row = await prisma.onboardingSession.create({
    data: {
      tokenHash: sha256(token),
      step: init.step,
      data: init.data as unknown as Prisma.InputJsonValue,
      expiresAt,
      leadId: init.leadId ?? null,
    },
    include: { lead: { include: { consents: true } } },
  });
  const jar = await cookies();
  jar.set(ONBOARDING_COOKIE, token, { httpOnly: true, secure: cookieSecure(), sameSite: "lax", path: "/", expires: expiresAt });
  return toState(row);
}

export async function updateOnboardingSession(
  id: string,
  patch: { step?: number; data?: SessionData; answers?: SessionAnswers; suggested?: SuggestedBoard; leadId?: string | null },
) {
  const row = await prisma.onboardingSession.update({
    where: { id },
    data: {
      ...(patch.leadId !== undefined && { leadId: patch.leadId }),
      ...(patch.step !== undefined && { step: patch.step }),
      ...(patch.data && { data: patch.data as unknown as Prisma.InputJsonValue }),
      ...(patch.answers && { answers: patch.answers as unknown as Prisma.InputJsonValue }),
      ...(patch.suggested && { suggestedBoard: patch.suggested as unknown as Prisma.InputJsonValue }),
    },
    select: { leadId: true, step: true, data: true },
  });
  // Holder leadet à jour: seneste aktivitet, højeste trin og telefonnummer (indtastes i trin 2)
  if (row.leadId) {
    const phone = (row.data as SessionData | null)?.company?.phone;
    await prisma.lead.updateMany({ where: { id: row.leadId }, data: { lastActivityAt: new Date(), ...(phone ? { phone } : {}) } });
    await prisma.lead.updateMany({ where: { id: row.leadId, step: { lt: row.step } }, data: { step: row.step } });
  }
}

export async function deleteOnboardingSession(id: string) {
  await prisma.onboardingSession.deleteMany({ where: { id } });
  const jar = await cookies();
  jar.delete(ONBOARDING_COOKIE);
}

/** GDPR: sletter udløbne sessioner. Kaldes fra jobkøen og ved oprettelse af nye sessioner. */
export async function cleanupExpiredOnboarding(): Promise<number> {
  const r = await prisma.onboardingSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return r.count;
}

/** Sletter alle sessioner, der hører til en e-mailadresse (GDPR-sletning / efter gennemført tilmelding). */
export async function deleteOnboardingSessionsForEmail(email: string): Promise<number> {
  const r = await prisma.onboardingSession.deleteMany({ where: { data: { path: ["contact", "email"], equals: email } } });
  return r.count;
}
