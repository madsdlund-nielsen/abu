import type { CheckoutInput, CheckoutResult, PaymentProvider } from "./types";

export class MockPayments implements PaymentProvider {
  readonly name = "mock" as const;

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    // Ingen betalingsside: gå direkte til accept-URL, som aktiverer abonnementet i mock-tilstand.
    return {
      url: input.acceptUrl,
      providerCustomerId: `mock-cust-${input.customer.id}`,
      providerSubscriptionId: input.subscriptionId,
    };
  }

  async cancelSubscription() {}
  async changePlan() {}
}
