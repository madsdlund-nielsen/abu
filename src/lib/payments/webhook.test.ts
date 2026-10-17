import { describe, expect, it } from "vitest";
import { statusForEvent } from "./webhook";

describe("statusForEvent", () => {
  it("mapper Frisbii-begivenheder til abonnementsstatus", () => {
    expect(statusForEvent("subscription_created")).toBe("ACTIVE");
    expect(statusForEvent("subscription_renewal")).toBe("ACTIVE");
    expect(statusForEvent("invoice_failed")).toBe("PAST_DUE");
    expect(statusForEvent("subscription_cancelled")).toBe("CANCELLED");
    expect(statusForEvent("subscription_expired")).toBe("CANCELLED");
    expect(statusForEvent("customer_created")).toBeNull();
  });
});
