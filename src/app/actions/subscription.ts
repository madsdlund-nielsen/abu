"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { cancelMeeting } from "@/lib/booking";
import { ensureLead, leadEligibleIds } from "@/lib/lead";
import { prisma } from "@/lib/db";
import { startCheckout } from "@/lib/checkout";
import { resolveBoard } from "@/lib/onboarding/board";
import { getPayments } from "@/lib/payments";
import { subscriptionEvents } from "@/lib/notifications/service";
import { planHandle } from "@/lib/pricing";
import { redirectWith } from "@/lib/redirect";
import { getEnv, isProductionEnv } from "@/lib/env";
import { afterSubscriptionActivated, getCustomerSubscription } from "@/lib/subscriptions";

async function parseBoard(formData: FormData, back: string) {
  const advisorIds = [...new Set(formData.getAll("advisorIds").map(String))];
  const board = await resolveBoard(advisorIds, Number(formData.get("weeks")));
  if ("error" in board) redirectWith(back, "err", board.error);
  return board;
}

/** Eksisterende kunde uden aktivt abonnement (fx afbrudt betaling) vælger board og går til betaling. */
export async function startSubscriptionAction(formData: FormData) {
  const user = await requireRole("CUSTOMER");
  const board = await parseBoard(formData, "/subscribe");
  const existing = await getCustomerSubscription(user.id);
  if (existing && existing.status !== "PENDING") {
    redirectWith("/account/subscription", "err", "Du har allerede et abonnement. Skift plan eller opsig det under Abonnement.");
  }
  let url: string;
  try {
    const r = await startCheckout({ userId: user.id, board, cancelPath: "/subscribe" });
    await audit(user.id, "subscription.checkout", "Subscription", r.subscriptionId);
    url = r.url;
  } catch (e) {
    console.error("[subscription] checkout fejlede", e);
    redirectWith("/subscribe", "err", "Betalingen kunne ikke startes. Prøv igen om lidt.");
  }
  redirect(url);
}

/** Skift board og/eller frekvens. Priserne fastfryses på ny ud fra rådgivernes aktuelle priser, og beløbet genberegnes. */
export async function changePlanAction(formData: FormData) {
  const user = await requireRole("CUSTOMER");
  const back = "/account/subscription";
  const board = await parseBoard(formData, back);
  const sub = await getCustomerSubscription(user.id);
  if (!sub || (sub.status !== "ACTIVE" && sub.status !== "PAST_DUE")) {
    redirectWith(back, "err", "Du har intet aktivt abonnement at ændre.");
  }
  // Den ansvarlige beholdes kun, hvis vedkommende stadig kan være ansvarlig (lead-tagget) – RLS håndhæver det samme (R-1)
  const prevLeadId = sub.advisors.find((a) => a.isLead)?.advisorId;
  const prevLead = prevLeadId && (await leadEligibleIds([prevLeadId])).has(prevLeadId) ? prevLeadId : undefined;
  try {
    await getPayments().changePlan(sub.providerSubscriptionId ?? sub.id, planHandle(board.weeks), board.monthlyPriceDkk);
  } catch (e) {
    console.error("[subscription] skift af plan fejlede", e);
    redirectWith(back, "err", "Planen kunne ikke ændres hos betalingsudbyderen. Prøv igen senere.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.subscriptionAdvisor.deleteMany({ where: { subscriptionId: sub.id } });
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        advisorCount: board.advisors.length,
        frequencyWeeks: board.weeks,
        monthlyPriceDkk: board.monthlyPriceDkk,
        advisors: { create: board.advisors.map((a) => ({ advisorId: a.id, pricePerMeetingDkk: a.pricePerMeetingDkk, isLead: a.id === prevLead })) },
      },
    });
  });
  await audit(user.id, "subscription.change_plan", "Subscription", sub.id);
  // Den ansvarlige beholder rollen, hvis vedkommende stadig er i boardet; ellers tildeles en ny automatisk
  await ensureLead(sub.id, "board_changed", user.id);
  const before = new Set(sub.advisors.map((a) => a.advisorId));
  const after = new Set(board.advisors.map((a) => a.id));
  const addedIds = [...after].filter((id) => !before.has(id));
  const removedIds = [...before].filter((id) => !after.has(id));
  if (addedIds.length || removedIds.length) await subscriptionEvents.boardChanged(sub.id, { addedIds, removedIds });
  redirectWith(back, "ok", "Dit board er opdateret. Allerede bookede møder med fjernede rådgivere bør aflyses og bookes igen.");
}

export async function cancelSubscriptionAction() {
  const user = await requireRole("CUSTOMER");
  const sub = await getCustomerSubscription(user.id);
  if (!sub) redirectWith("/account/subscription", "err", "Intet abonnement at opsige.");
  if (sub.status !== "PENDING") {
    try {
      await getPayments().cancelSubscription(sub.providerSubscriptionId ?? sub.id);
    } catch (e) {
      console.error("[subscription] opsigelse fejlede", e);
      redirectWith("/account/subscription", "err", "Opsigelsen kunne ikke gennemføres hos betalingsudbyderen. Prøv igen.");
    }
  }
  await prisma.subscription.update({ where: { id: sub.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  const future = await prisma.meeting.findMany({
    where: { subscriptionId: sub.id, status: "BOOKED", startsAt: { gt: new Date() } },
    select: { id: true },
  });
  for (const m of future) await cancelMeeting({ meetingId: m.id, actorId: user.id }).catch(() => {});
  await audit(user.id, "subscription.cancel", "Subscription", sub.id);
  redirectWith("/account/subscription", "ok", "Dit abonnement er opsagt, og kommende møder er aflyst.");
}

/**
 * Mock-betaling (kun udvikling/test): kunden bekræfter testbetalingen med et klik (POST). Med en rigtig udbyder sker
 * aktivering udelukkende via den signerede webhook. Afvises altid i produktion.
 */
export async function completeMockPaymentAction(formData: FormData) {
  const user = await requireRole("CUSTOMER");
  if (getEnv().PAYMENT_PROVIDER !== "mock" || isProductionEnv()) redirectWith("/subscribe", "err", "Testbetaling er ikke tilgængelig.");
  const id = String(formData.get("sub") ?? "");
  const sub = await prisma.subscription.findFirst({ where: { id, customerId: user.id, status: "PENDING", provider: "mock" } });
  if (!sub) redirectWith("/subscribe", "err", "Abonnementet blev ikke fundet.");
  await prisma.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", startedAt: new Date() } });
  await audit(user.id, "subscription.activate_mock", "Subscription", sub.id);
  await afterSubscriptionActivated(sub.id);
  redirect(`/subscribe/success?sub=${sub.id}`);
}
