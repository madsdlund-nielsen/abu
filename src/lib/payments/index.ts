import { getEnv } from "../env";
import { FrisbiiPayments } from "./frisbii";
import { MockPayments } from "./mock";
import type { PaymentProvider } from "./types";

let provider: PaymentProvider | null = null;

export function getPayments(): PaymentProvider {
  if (!provider) provider = getEnv().PAYMENT_PROVIDER === "frisbii" ? new FrisbiiPayments() : new MockPayments();
  return provider;
}
