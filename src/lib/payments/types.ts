import type { VerifyResult } from "../webhooks/signature";

export interface CheckoutInput {
  /** Vores Subscription.id – bruges som abonnements-handle hos udbyderen */
  subscriptionId: string;
  /** Frisbii-plan pr. frekvens, fx abu-8w */
  planHandle: string;
  /** Månedspris i hele kroner ekskl. moms; sættes som beløb pr. abonnement (amount-override) */
  amountDkk: number;
  customer: {
    id: string;
    email: string;
    name: string;
    companyName: string;
    cvr: string;
  };
  acceptUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  /** URL kunden sendes til */
  url: string;
  providerCustomerId: string;
  providerSubscriptionId: string;
}

export interface PaymentProvider {
  readonly name: "mock" | "frisbii";
  /** Verificerer en webhook ud fra den RÅ body og headers (signatur + tidsstempel). Kaldes før JSON-parsing. */
  verifyWebhook(rawBody: string, headers: Headers, now?: Date): VerifyResult;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  changePlan(providerSubscriptionId: string, planHandle: string, amountDkk: number): Promise<void>;
}
