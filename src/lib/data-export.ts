import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * GDPR-dataeksport (M-2). Hver tabel har en eksplicit `select`, så kun felter, personen har ret til, kommer med. Bevidst
 * udeladt: adgangskode-hash, sessioner, værtens mødelink (hostRoomUrl), mødelinks og udbyder-id'er (betaling/video),
 * lagernøgler, login-spærring og andre brugeres kontaktoplysninger.
 */
export const EXPORT_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  createdAt: true,
  consentAt: true,
  recordingConsentAt: true,
  recordingConsentVersion: true,
  emailOptOutAt: true,
  smsOptOutAt: true,
  deletionRequestedAt: true,
  customerProfile: {
    select: {
      companyName: true,
      cvr: true,
      address: true,
      billingEmail: true,
      cvrVerified: true,
      cvrData: true,
      testAnswers: true,
      subscriptions: {
        select: {
          id: true,
          advisorCount: true,
          frequencyWeeks: true,
          monthlyPriceDkk: true,
          status: true,
          startedAt: true,
          cancelledAt: true,
          createdAt: true,
          advisors: { select: { pricePerMeetingDkk: true, advisor: { select: { user: { select: { name: true } } } } } },
        },
      },
    },
  },
  advisorProfile: {
    select: {
      title: true,
      bio: true,
      photoUrl: true,
      active: true,
      pricePerMeetingDkk: true,
      availabilityRules: { select: { weekday: true, startMinute: true, endMinute: true } },
      availabilityBlocks: { select: { startsAt: true, endsAt: true, reason: true } },
      tags: { select: { tag: { select: { name: true } } } },
    },
  },
} satisfies Prisma.UserSelect;

export const EXPORT_MEETING_SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  cancelledAt: true,
  createdAt: true,
  participants: { select: { addedAt: true, user: { select: { name: true, role: true } } } },
  transcript: { select: { text: true, summary: true, segments: true, language: true, createdAt: true } },
} satisfies Prisma.MeetingSelect;

export async function buildDataExport(user: { id: string; email: string }) {
  const [profile, meetings, auditLog, onboardingSessions, notificationLog, marketingConsents, lead] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: EXPORT_USER_SELECT }),
    prisma.meeting.findMany({ where: { participants: { some: { userId: user.id } } }, select: EXPORT_MEETING_SELECT, orderBy: { startsAt: "asc" } }),
    prisma.auditLog.findMany({ where: { userId: user.id }, select: { action: true, entity: true, entityId: true, detail: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    // Eventuelle ufuldendte tilmeldinger med samme e-mail (tokenHash udelades)
    prisma.onboardingSession.findMany({
      where: { data: { path: ["contact", "email"], equals: user.email } },
      select: { step: true, data: true, answers: true, suggestedBoard: true, createdAt: true, expiresAt: true },
    }),
    prisma.notificationLog.findMany({
      where: { recipientUserId: user.id },
      select: { trigger: true, templateKey: true, channel: true, recipientAddress: true, status: true, subject: true, preview: true, error: true, scheduledFor: true, sentAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.marketingConsent.findMany({
      where: { OR: [{ userId: user.id }, { email: { equals: user.email, mode: "insensitive" } }] },
      select: { email: true, phone: true, emailConsent: true, smsConsent: true, consentedAt: true, text: true, textVersion: true, source: true, ipAddress: true, userAgent: true, emailWithdrawnAt: true, smsWithdrawnAt: true },
      orderBy: { consentedAt: "asc" },
    }),
    prisma.lead.findUnique({
      where: { email: user.email.toLowerCase() },
      select: { email: true, name: true, phone: true, step: true, source: true, createdAt: true, lastActivityAt: true, convertedAt: true },
    }),
  ]);
  return { exportedAt: new Date().toISOString(), user: profile, meetings, onboardingSessions, lead, marketingConsents, notificationLog, auditLog };
}
