import { prisma } from "./db";
import { getEnv } from "./env";
import type { ResolvedBoard } from "./onboarding/board";
import { getPayments } from "./payments";
import { planHandle } from "./pricing";

/**
 * Opretter et afventende abonnement (med fastfrosne rådgiverpriser) og starter betaling.
 * Returnerer URL'en kunden sendes til. Afventende forsøg erstattes. Kaster ved betalingsfejl (abonnementet slettes igen).
 */
export async function startCheckout(opts: { userId: string; board: ResolvedBoard; cancelPath: string; acceptPath?: string }) {
  const { userId, board } = opts;
  const profile = await prisma.customerProfile.findUniqueOrThrow({ where: { userId }, include: { user: true } });
  await prisma.subscription.deleteMany({ where: { customerId: userId, status: "PENDING" } });
  const payments = getPayments();
  const sub = await prisma.subscription.create({
    data: {
      customerId: userId,
      advisorCount: board.advisors.length,
      frequencyWeeks: board.weeks,
      monthlyPriceDkk: board.monthlyPriceDkk,
      provider: payments.name,
      advisors: { create: board.advisors.map((a) => ({ advisorId: a.id, pricePerMeetingDkk: a.pricePerMeetingDkk })) },
    },
  });
  const base = getEnv().APP_URL.replace(/\/$/, "");
  try {
    const checkout = await payments.createCheckout({
      subscriptionId: sub.id,
      planHandle: planHandle(board.weeks),
      amountDkk: board.monthlyPriceDkk,
      customer: {
        id: userId,
        email: profile.billingEmail,
        name: profile.user.name,
        companyName: profile.companyName,
        cvr: profile.cvr,
      },
      acceptUrl: `${base}${opts.acceptPath ?? "/subscribe/success"}?sub=${sub.id}`,
      cancelUrl: `${base}${opts.cancelPath}${opts.cancelPath.includes("?") ? "&" : "?"}err=${encodeURIComponent("Betalingen blev afbrudt.")}`,
    });
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { providerCustomerId: checkout.providerCustomerId, providerSubscriptionId: checkout.providerSubscriptionId },
    });
    return { url: checkout.url, subscriptionId: sub.id };
  } catch (e) {
    await prisma.subscription.delete({ where: { id: sub.id } }).catch(() => {});
    throw e;
  }
}
