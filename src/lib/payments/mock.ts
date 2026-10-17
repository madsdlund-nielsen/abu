import type { CheckoutInput, CheckoutResult, PaymentProvider } from "./types";

/**
 * Kun til udvikling/test (forbudt i produktion af opstarts-guarden). Kunden sendes til en intern testbetalingsside, der
 * aktiverer abonnementet ved et klik (POST) – aldrig ved et GET-kald.
 */
export class MockPayments implements PaymentProvider {
  readonly name = "mock" as const;

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const origin = new URL(input.acceptUrl).origin;
    return {
      url: `${origin}/subscribe/mock-betaling?sub=${encodeURIComponent(input.subscriptionId)}`,
      providerCustomerId: `mock-cust-${input.customer.id}`,
      providerSubscriptionId: input.subscriptionId,
    };
  }

  async cancelSubscription() {}
  async changePlan() {}
}
