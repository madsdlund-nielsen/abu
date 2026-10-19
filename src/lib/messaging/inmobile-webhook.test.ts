import { describe, expect, it } from "vitest";
import { asSystem, describeDb } from "../../test/db";
import { authorizeInmobileWebhook } from "./inmobile-webhook";

const url = (q = "") => `https://abu.example.com/api/webhooks/inmobile${q}`;

describe("inMobile-webhook (M-7)", () => {
  it("accepterer hemmeligheden i header eller URL, og den forrige under rotation", () => {
    expect(authorizeInmobileWebhook(url(), new Headers({ "x-webhook-secret": "ny" }), ["ny", ""])).toBe(true);
    expect(authorizeInmobileWebhook(url("?secret=ny"), new Headers(), ["ny", ""])).toBe(true);
    expect(authorizeInmobileWebhook(url("?secret=gammel"), new Headers(), ["ny", "gammel"])).toBe(true);
  });
  it("afviser forkert, manglende eller tom hemmelighed (fail-closed)", () => {
    expect(authorizeInmobileWebhook(url("?secret=forkert"), new Headers(), ["ny", "gammel"])).toBe(false);
    expect(authorizeInmobileWebhook(url(), new Headers(), ["ny"])).toBe(false);
    expect(authorizeInmobileWebhook(url("?secret="), new Headers(), ["", ""])).toBe(false);
  });
});

describeDb("inMobile STOP kun fra kendte numre (M-7)", () => {
  it("kender numre, vi har sendt til, men ikke tilfældige numre", async () => {
    const { prisma } = await import("../db");
    const { isKnownSmsNumber } = await import("./inmobile-webhook");
    const n = `+459${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    // Webhooken kører i systemkontekst (route.ts), efter at hemmeligheden er godkendt
    await asSystem(async () => {
      expect(await isKnownSmsNumber(n)).toBe(false);
      const id = `t-${Date.now()}`;
      await prisma.notificationLog.create({ data: { id, trigger: "test", channel: "SMS", recipientAddress: n, entityType: "test", entityId: id, dedupe: id, scheduledFor: new Date(), templateKey: "t" } });
      expect(await isKnownSmsNumber(n)).toBe(true);
      await prisma.notificationLog.delete({ where: { id } });
    });
  });
});
