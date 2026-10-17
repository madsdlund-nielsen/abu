import { getEnv } from "../env";
import type { CheckoutInput, CheckoutResult, PaymentProvider } from "./types";

/**
 * Frisbii (tidl. Reepay). Endpoints og payload-felter er skrevet efter vores bedste kendskab til
 * Reepay-API'et og SKAL verificeres mod en rigtig konto (se README/OPEN_ITEMS).
 */
export class FrisbiiPayments implements PaymentProvider {
  readonly name = "frisbii" as const;

  private auth() {
    // Basic auth: privat nøgle som brugernavn, tom adgangskode
    return "Basic " + Buffer.from(`${getEnv().FRISBII_PRIVATE_KEY}:`).toString("base64");
  }

  private async call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: this.auth(), "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Frisbii ${method} ${url} fejlede (${res.status}): ${(await res.text()).slice(0, 500)}`);
    return res.status === 204 ? null : ((await res.json()) as Record<string, unknown>);
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const env = getEnv();
    const json = await this.call(`${env.FRISBII_CHECKOUT_API_URL}/v1/session/subscription`, "POST", {
      customer: {
        handle: input.customer.id,
        email: input.customer.email,
        company: input.customer.companyName,
        vat: input.customer.cvr,
        generate_handle: false,
      },
      // GÆT (skal verificeres mod Frisbii): beløbet pr. abonnement overstyrer planens beløb. Mindste enhed (øre),
      // ekskl. moms; momsen lægges til efter planens momsopsætning (amount_incl_vat=false).
      subscription: {
        plan: input.planHandle,
        handle: input.subscriptionId,
        amount: input.amountDkk * 100,
        amount_incl_vat: false,
      },
      accept_url: input.acceptUrl,
      cancel_url: input.cancelUrl,
      locale: "da_DK",
    });
    const url = typeof json?.url === "string" ? json.url : null;
    const id = typeof json?.id === "string" ? json.id : null;
    if (!url) throw new Error("Frisbii returnerede ingen checkout-URL");
    return {
      url: url || `https://checkout.reepay.com/#/${id}`,
      providerCustomerId: input.customer.id,
      providerSubscriptionId: input.subscriptionId,
    };
  }

  async cancelSubscription(handle: string) {
    await this.call(`${getEnv().FRISBII_API_URL}/v1/subscription/${encodeURIComponent(handle)}/cancel`, "POST");
  }

  async changePlan(handle: string, planHandle: string, amountDkk: number) {
    // GÆT (skal verificeres): planskift med nyt beløb-override i samme kald.
    await this.call(`${getEnv().FRISBII_API_URL}/v1/subscription/${encodeURIComponent(handle)}`, "PUT", {
      plan: planHandle,
      amount: amountDkk * 100,
      amount_incl_vat: false,
    });
  }
}
