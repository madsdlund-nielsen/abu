import type { Prisma } from "@prisma/client";
import { audit } from "./audit";
import { prisma } from "./db";
import { deleteNotificationDataFor } from "./notifications/service";
import { deleteOnboardingSessionsForEmail } from "./onboarding/session";
import { getPayments } from "./payments";
import type { PaymentProvider } from "./payments/types";
import { getStorage } from "./storage";
import type { StorageProvider } from "./storage/types";

export interface ErasureDeps {
  payments: Pick<PaymentProvider, "cancelSubscription">;
  storage: Pick<StorageProvider, "delete">;
}

export type ErasureResult =
  | { ok: true; cancelled: number; objects: number; webhookEvents: number }
  | { ok: false; error: string };

/**
 * GDPR-sletning (M-3). Rækkefølge:
 *  1. Aktive abonnementer opsiges hos betalingsudbyderen (lykkes det ikke, slettes intet – ellers kunne der blive ved med
 *     at blive trukket penge).
 *  2. Optagelser for kundens møder slettes fra lageret (rækkerne forsvinder med kaskaden, objekterne gør ikke).
 *  3. Webhook-payloads med kundens data (betaling og video) slettes.
 *  4. Onboarding, notifikationslog, leads og samtykker for e-mailen, og til sidst brugeren (kaskade).
 * Audit-loggen beholdes (userId sættes til null).
 */
export async function eraseUser(userId: string, actorId: string, deps: ErasureDeps = { payments: getPayments(), storage: getStorage() }): Promise<ErasureResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "Brugeren findes ikke." };
  const subs = await prisma.subscription.findMany({
    where: { customerId: userId },
    select: { id: true, status: true, providerSubscriptionId: true, providerCustomerId: true, meetings: { select: { id: true, providerMeetingId: true, recordings: { select: { storageKey: true } } } } },
  });

  // 1) Opsig hos udbyderen
  let cancelled = 0;
  for (const s of subs) {
    if (s.status === "CANCELLED") continue;
    try {
      await deps.payments.cancelSubscription(s.providerSubscriptionId ?? s.id);
      cancelled++;
    } catch (e) {
      console.error("[erasure] opsigelse fejlede", e instanceof Error ? e.message : e);
      return { ok: false, error: "Abonnementet kunne ikke opsiges hos betalingsudbyderen. Intet er slettet – prøv igen, eller opsig det manuelt først." };
    }
  }
  if (cancelled) await prisma.subscription.updateMany({ where: { customerId: userId, status: { not: "CANCELLED" } }, data: { status: "CANCELLED", cancelledAt: new Date() } });

  // 2) Optagelser i lageret
  const keys = subs.flatMap((s) => s.meetings.flatMap((m) => m.recordings.map((r) => r.storageKey))).filter((k): k is string => Boolean(k));
  let objects = 0;
  for (const key of keys) {
    try {
      await deps.storage.delete(key);
      objects++;
    } catch (e) {
      console.error("[erasure] objekt kunne ikke slettes", e instanceof Error ? e.message : e);
      return { ok: false, error: "En optagelse kunne ikke slettes fra lageret. Prøv igen." };
    }
  }

  // 3) Webhook-payloads (betaling: abonnement/kunde; video: mødets rum)
  const subIds = subs.flatMap((s) => [s.id, s.providerSubscriptionId]).filter((x): x is string => Boolean(x));
  const customerIds = [userId, ...subs.map((s) => s.providerCustomerId)].filter((x): x is string => Boolean(x));
  const meetingRefs = subs.flatMap((s) => s.meetings.map((m) => m.providerMeetingId)).filter((x): x is string => Boolean(x));
  const or: Prisma.WebhookEventWhereInput[] = [
    ...subIds.map((v) => ({ payload: { path: ["subscription"], equals: v } })),
    ...customerIds.map((v) => ({ payload: { path: ["customer"], equals: v } })),
    ...meetingRefs.map((v) => ({ externalId: { startsWith: `video:${v}:` } })),
  ];
  const webhookEvents = or.length ? (await prisma.webhookEvent.deleteMany({ where: { OR: or } })).count : 0;

  // 4) Øvrige data om personen og selve kontoen
  await audit(actorId, "user.delete", "User", userId, `Opsagt: ${cancelled}, optagelser: ${objects}, webhooks: ${webhookEvents}`);
  await deleteOnboardingSessionsForEmail(user.email);
  await deleteNotificationDataFor(user);
  await prisma.marketingConsent.deleteMany({ where: { email: { equals: user.email, mode: "insensitive" } } });
  await prisma.lead.deleteMany({ where: { email: { equals: user.email, mode: "insensitive" } } });
  await prisma.user.delete({ where: { id: userId } });
  return { ok: true, cancelled, objects, webhookEvents };
}

export const WEBHOOK_PAYLOAD_RETENTION_DAYS = 30;
const WEBHOOK_ROW_RETENTION_DAYS = 400;

/**
 * Webhook-payloads indeholder kundedata (e-mail, CVR, telefon). Efter 30 dage fjernes payloaden; rækken (id) bevares som
 * idempotens-nøgle, til den slettes efter 400 dage.
 */
export async function cleanupWebhookPayloads(now = new Date()): Promise<{ redacted: number; deleted: number }> {
  const day = 86_400_000;
  const redacted = await prisma.$executeRaw`
    UPDATE "WebhookEvent" SET payload = '{"fjernet": true}'::jsonb
    WHERE "createdAt" < ${new Date(now.getTime() - WEBHOOK_PAYLOAD_RETENTION_DAYS * day)} AND payload <> '{"fjernet": true}'::jsonb`;
  const deleted = (await prisma.webhookEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - WEBHOOK_ROW_RETENTION_DAYS * day) } } })).count;
  return { redacted, deleted };
}
