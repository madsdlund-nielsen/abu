import type { Prisma, SubscriptionStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { subscriptionEvents } from "../notifications/service";
import { afterSubscriptionActivated } from "../subscriptions";

/** Felter vi bruger fra en (allerede signaturverificeret) betalingsbegivenhed. Øvrige felter ignoreres. */
export const paymentEventSchema = z.looseObject({
  id: z.string().min(1).max(200),
  event_id: z.string().min(1).max(200).optional(),
  event_type: z.string().min(1).max(100),
  timestamp: z.string().max(100).optional(),
  subscription: z.string().min(1).max(200).optional(),
  customer: z.string().max(200).optional(),
});
export type FrisbiiEvent = z.infer<typeof paymentEventSchema>;

/** Hvilken status udløser en given Frisbii-begivenhed? null = ignorer. */
export function statusForEvent(eventType: string): SubscriptionStatus | null {
  switch (eventType) {
    case "subscription_created":
    case "subscription_renewal":
    case "subscription_reactivated":
    case "invoice_settled":
      return "ACTIVE";
    case "invoice_failed":
      return "PAST_DUE";
    case "subscription_cancelled":
    case "subscription_expired":
      return "CANCELLED";
    default:
      return null;
  }
}

/** Idempotent behandling. Returnerer "duplicate" hvis begivenheden allerede er set. */
export async function processFrisbiiEvent(evt: FrisbiiEvent): Promise<"processed" | "duplicate" | "ignored"> {
  const externalId = evt.event_id ?? evt.id;
  try {
    await prisma.webhookEvent.create({
      data: { provider: "frisbii", externalId, payload: evt as unknown as Prisma.InputJsonValue },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return "duplicate";
    throw e;
  }

  const status = statusForEvent(evt.event_type);
  let result: "processed" | "ignored" = "ignored";
  if (status && evt.subscription) {
    const sub = await prisma.subscription.findFirst({
      where: { OR: [{ id: evt.subscription }, { providerSubscriptionId: evt.subscription }] },
    });
    const staleReactivation = sub?.status === "CANCELLED" && status === "ACTIVE" && evt.event_type !== "subscription_reactivated";
    if (sub && !staleReactivation) {
      const data: Prisma.SubscriptionUpdateInput = { status };
      if (status === "ACTIVE" && !sub.startedAt) data.startedAt = new Date();
      if (status === "CANCELLED") data.cancelledAt = new Date();
      await prisma.subscription.update({ where: { id: sub.id }, data });
      result = "processed";
      // Besked kun ved overgang til PAST_DUE (Frisbii gentager invoice_failed ved hvert forsøg)
      if (status === "PAST_DUE" && sub.status !== "PAST_DUE") await subscriptionEvents.paymentFailed(sub.id);
      if (status === "ACTIVE" && sub.status === "PENDING") await afterSubscriptionActivated(sub.id);
    }
  }
  await prisma.webhookEvent.update({ where: { externalId }, data: { processedAt: new Date() } });
  return result;
}
