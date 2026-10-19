import type { Prisma } from "@prisma/client";
import { AVATAR_SIZE, avatarObjectKeys, avatarSrc, avatarVersion } from "./avatar-url";
import { prisma } from "./db";
import { withSystemContext } from "./db-context";
import { nameOf, userDirectory } from "./user-directory";

/**
 * GDPR-dataeksport (M-2). Hver tabel har en eksplicit `select`, så kun felter, personen har ret til, kommer med. Bevidst
 * udeladt: adgangskode-hash, sessioner, værtens mødelink (hostRoomUrl), mødelinks og udbyder-id'er (betaling/video),
 * optagelsernes lagernøgler, login-spærring, TOTP-hemmeligheden, gendannelseskodernes hash, tokens for betroede
 * enheder og andre brugeres kontaktoplysninger. Med er: om totrinsbekræftelse er slået til, og listen over betroede
 * enheder (grov beskrivelse, omtrentlig IP, oprettet/udløber/senest brugt).
 *
 * Rådgiverens profilbillede er med som metadata (lagernøgle og tidspunkt, `profilePhoto`); selve billedet kan hentes
 * på `/api/avatar/<id>?size=512` eller rekvireres hos os. Det gemte billede har ingen EXIF/GPS-data.
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
  lastLoginAt: true,
  deactivatedAt: true,
  // Totrinsbekræftelse: kun om den er slået til og hvornår – aldrig hemmeligheden eller gendannelseskoderne
  mfaEnabledAt: true,
  trustedDevices: { select: { label: true, ipPrefix: true, createdAt: true, expiresAt: true, lastUsedAt: true }, orderBy: { createdAt: "asc" } },
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
          // Rådgivernes navne tilføjes bagefter fra kataloget (RLS: kunden kan ikke læse rådgivernes User-rækker)
          advisors: { select: { advisorId: true, pricePerMeetingDkk: true, isLead: true } },
        },
      },
    },
  },
  advisorProfile: {
    select: {
      title: true,
      bio: true,
      photoKey: true,
      photoUpdatedAt: true,
      active: true,
      pricePerMeetingDkk: true,
      availabilityRules: { select: { weekday: true, startMinute: true, endMinute: true } },
      availabilityBlocks: { select: { startsAt: true, endsAt: true, reason: true } },
      // Tags (også interne admin-tags, som personen har ret til at se i eksporten) hentes i systemkontekst, se nedenfor
      // Rådgiverens pladser i boards, inkl. om vedkommende er ansvarlig rådgiver (uden kundedata)
      boards: { select: { isLead: true, pricePerMeetingDkk: true, subscription: { select: { status: true, createdAt: true } } } },
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
  // Deltagernes navn og rolle tilføjes bagefter fra kataloget (RLS: kun navn/rolle på mødekolleger)
  participants: { select: { userId: true, addedAt: true } },
  transcript: { select: { text: true, summary: true, segments: true, language: true, createdAt: true } },
} satisfies Prisma.MeetingSelect;

/**
 * RLS: kontoen, møderne og notifikationsloggen læses som brugeren selv (egne rækker). Det, der hører til personen via
 * e-mailen (ufærdige tilmeldinger, leadet og samtykker fra før kontoen), egne audit-rækker og egne tags (også interne)
 * er ikke synlige for brugeren selv – de hentes i systemkontekst, kun for netop denne bruger og e-mail («gdpr.export»).
 */
export async function buildDataExport(user: { id: string; email: string }) {
  const [profile, rawMeetings, notificationLog, personal] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: EXPORT_USER_SELECT }),
    prisma.meeting.findMany({ where: { participants: { some: { userId: user.id } } }, select: EXPORT_MEETING_SELECT, orderBy: { startsAt: "asc" } }),
    prisma.notificationLog.findMany({
      where: { recipientUserId: user.id },
      select: { trigger: true, templateKey: true, channel: true, recipientAddress: true, status: true, subject: true, preview: true, error: true, scheduledFor: true, sentAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    withSystemContext("gdpr.export", () =>
      Promise.all([
        prisma.auditLog.findMany({ where: { userId: user.id }, select: { action: true, entity: true, entityId: true, detail: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
        // Kun tilmeldinger, samtykker og leads, der er knyttet til kontoen (convertLead) – ikke alt med samme e-mail
        // (M-1): kontoens e-mail er ikke bekræftet ved oprettelsen, så et e-mail-match beviser ikke, at det er samme
        // person. Øvrige leads med e-mailen udleveres efter en manuel anmodning (README «Row-Level Security»).
        prisma.onboardingSession.findMany({
          where: { lead: { userId: user.id } },
          select: { step: true, data: true, answers: true, suggestedBoard: true, createdAt: true, expiresAt: true },
        }),
        prisma.marketingConsent.findMany({
          where: { OR: [{ userId: user.id }, { lead: { userId: user.id } }] },
          select: { email: true, phone: true, emailConsent: true, smsConsent: true, consentedAt: true, text: true, textVersion: true, source: true, ipAddress: true, userAgent: true, emailWithdrawnAt: true, smsWithdrawnAt: true },
          orderBy: { consentedAt: "asc" },
        }),
        prisma.lead.findMany({
          where: { userId: user.id },
          select: { email: true, name: true, phone: true, step: true, source: true, createdAt: true, lastActivityAt: true, convertedAt: true },
          orderBy: { createdAt: "asc" },
        }),
        prisma.advisorTag.findMany({ where: { advisorId: user.id }, select: { tag: { select: { name: true, kind: true } } } }),
      ]),
    ),
  ]);
  const [auditLog, onboardingSessions, marketingConsents, leads, tags] = personal;
  const subs = profile.customerProfile?.subscriptions ?? [];
  const names = await userDirectory([...subs.flatMap((s) => s.advisors.map((a) => a.advisorId)), ...rawMeetings.flatMap((m) => m.participants.map((p) => p.userId))]);
  const customerProfile = profile.customerProfile && {
    ...profile.customerProfile,
    subscriptions: subs.map((s) => ({
      ...s,
      advisors: s.advisors.map(({ advisorId, ...a }) => ({ ...a, advisor: { user: { name: nameOf(names, advisorId, "") } } })),
    })),
  };
  const meetings = rawMeetings.map((m) => ({
    ...m,
    participants: m.participants.map(({ userId, addedAt }) => ({ addedAt, user: { name: nameOf(names, userId, ""), role: names.get(userId)?.role ?? null } })),
  }));
  const advisorProfile = profile.advisorProfile && { ...profile.advisorProfile, tags };
  const { mfaEnabledAt, trustedDevices, ...rest } = { ...profile, customerProfile, advisorProfile };
  const twoFactor = { enabled: mfaEnabledAt !== null, enabledAt: mfaEnabledAt, trustedDevices };
  return { exportedAt: new Date().toISOString(), user: rest, twoFactor, profilePhoto: profilePhotoInfo(user.id, profile.advisorProfile), meetings, onboardingSessions, leads, marketingConsents, notificationLog, auditLog };
}

/** Metadata om profilbilledet + hvordan selve billedet fås (det indgår ikke i JSON-filen). */
export function profilePhotoInfo(userId: string, profile: { photoKey: string | null; photoUpdatedAt: Date | null } | null | undefined) {
  if (!profile?.photoKey) return null;
  return {
    storageKeys: avatarObjectKeys(profile.photoKey),
    updatedAt: profile.photoUpdatedAt,
    format: "WebP, 512 × 512 og 96 × 96 pixels, uden EXIF/GPS-metadata",
    note: `Selve billedet er ikke med i filen. Hent det som indlogget på ${avatarSrc(userId, avatarVersion(profile.photoUpdatedAt) ?? "0", AVATAR_SIZE)}, eller skriv til os, så sender vi det.`,
  };
}
