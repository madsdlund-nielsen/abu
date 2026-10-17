export interface CheckoutInput {
  /** Vores Subscription.id – bruges som abonnements-handle hos udbyderen */
  subscriptionId: string;
  planHandle: string;
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
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  changePlan(providerSubscriptionId: string, planHandle: string): Promise<void>;
}
