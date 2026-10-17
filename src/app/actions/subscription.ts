"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { cancelMeeting } from "@/lib/booking";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getPayments } from "@/lib/payments";
import { isAdvisorCount, isFrequencyWeeks, monthlyPriceDkk, planHandle } from "@/lib/pricing";
import { redirectWith } from "@/lib/redirect";
import { getCustomerSubscription } from "@/lib/subscriptions";

const planSchema = z.object({
  advisors: z.coerce.number().int(),
  weeks: z.coerce.number().int(),
});

async function parsePlan(formData: FormData, back: string) {
  const parsed = planSchema.safeParse({ advisors: formData.get("advisors"), weeks: formData.get("weeks") });
  if (!parsed.success || !isAdvisorCount(parsed.data.advisors) || !isFrequencyWeeks(parsed.data.weeks)) {
    redirectWith(back, "err", "Vælg et gyldigt antal rådgivere og en gyldig frekvens.");
  }
  const advisorIds = [...new Set(formData.getAll("advisorIds").map(String))];
  if (advisorIds.length !== parsed.data.advisors) {
    redirectWith(back, "err", `Vælg præcis ${parsed.data.advisors} rådgivere.`);
  }
  const found = await prisma.advisorProfile.count({ where: { userId: { in: advisorIds }, active: true } });
  if (found !== advisorIds.length) redirectWith(back, "err", "En af de valgte rådgivere er ikke tilgængelig.");
  return { advisors: parsed.data.advisors, weeks: parsed.data.weeks, advisorIds };
}

export async function startSubscriptionAction(formData: FormData) {
  const user = await requireRole("CUSTOMER");
  const plan = await parsePlan(formData, "/subscribe");

  const existing = await getCustomerSubscription(user.id);
  if (existing && existing.status !== "PENDING") {
    redirectWith("/account/subscription", "err", "Du har allerede et abonnement. Skift plan eller opsig det under Abonnement.");
  }
  // Afventende forsøg erstattes
  await prisma.subscription.deleteMany({ where: { customerId: user.id, status: "PENDING" } });

  const profile = await prisma.customerProfile.findUniqueOrThrow({ where: { userId: user.id } });
  const payments = getPayments();
  const sub = await prisma.subscription.create({
    data: {
      customerId: user.id,
      advisorCount: plan.advisors,
      frequencyWeeks: plan.weeks,
      monthlyPriceDkk: monthlyPriceDkk(plan.advisors, plan.weeks),
      provider: payments.name,
      advisors: { create: plan.advisorIds.map((advisorId) => ({ advisorId })) },
    },
  });

  const base = getEnv().APP_URL.replace(/\/$/, "");
  let url: string;
  try {
    const checkout = await payments.createCheckout({
      subscriptionId: sub.id,
      planHandle: planHandle(plan.advisors, plan.weeks),
      customer: {
        id: user.id,
        email: profile.billingEmail,
        name: user.name,
        companyName: profile.companyName,
        cvr: profile.cvr,
      },
      acceptUrl: `${base}/subscribe/success?sub=${sub.id}`,
      cancelUrl: `${base}/subscribe?err=${encodeURIComponent("Betalingen blev afbrudt.")}`,
    });
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { providerCustomerId: checkout.providerCustomerId, providerSubscriptionId: checkout.providerSubscriptionId },
    });
    url = checkout.url;
  } catch (e) {
    console.error("[subscription] checkout fejlede", e);
    await prisma.subscription.delete({ where: { id: sub.id } });
    redirectWith("/subscribe", "err", "Betalingen kunne ikke startes. Prøv igen om lidt.");
  }
  await audit(user.id, "subscription.checkout", "Subscription", sub.id);
  redirect(url);
}

export async function changePlanAction(formData: FormData) {
  const user = await requireRole("CUSTOMER");
  const back = "/account/subscription";
  const plan = await parsePlan(formData, back);
  const sub = await getCustomerSubscription(user.id);
  if (!sub || (sub.status !== "ACTIVE" && sub.status !== "PAST_DUE")) {
    redirectWith(back, "err", "Du har intet aktivt abonnement at ændre.");
  }
  try {
    await getPayments().changePlan(sub.providerSubscriptionId ?? sub.id, planHandle(plan.advisors, plan.weeks));
  } catch (e) {
    console.error("[subscription] skift af plan fejlede", e);
    redirectWith(back, "err", "Planen kunne ikke ændres hos betalingsudbyderen. Prøv igen senere.");
  }
  await prisma.$transaction([
    prisma.subscriptionAdvisor.deleteMany({ where: { subscriptionId: sub.id } }),
    prisma.subscription.update({
      where: { id: sub.id },
      data: {
        advisorCount: plan.advisors,
        frequencyWeeks: plan.weeks,
        monthlyPriceDkk: monthlyPriceDkk(plan.advisors, plan.weeks),
        advisors: { create: plan.advisorIds.map((advisorId) => ({ advisorId })) },
      },
    }),
  ]);
  await audit(user.id, "subscription.change_plan", "Subscription", sub.id);
  redirectWith(back, "ok", "Din plan er ændret. Allerede bookede møder med fjernede rådgivere bør aflyses og bookes igen.");
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
