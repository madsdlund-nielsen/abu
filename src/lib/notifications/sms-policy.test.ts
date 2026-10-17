import { describe, expect, it } from "vitest";
import { describeDb, uid } from "../../test/db";
import { isSmsDestinationAllowed, parseSmsCountries, smsCapReached, smsCountryCode } from "./sms-policy";

describe("SMS-politik (M-5)", () => {
  it("finder landekoden med længste præfiks", () => {
    expect(smsCountryCode("+4520304050")).toBe("45");
    expect(smsCountryCode("+298123456")).toBe("298");
    expect(smsCountryCode("+358401234567")).toBe("358");
    expect(smsCountryCode("+882123456789")).toBeNull(); // satellit/premium – ukendt
    expect(smsCountryCode("4520304050")).toBeNull();
  });

  it("tillader kun lande på listen (standard Danmark)", () => {
    const dk = parseSmsCountries("");
    expect(dk).toEqual(["45"]);
    expect(isSmsDestinationAllowed("+4520304050", dk)).toBe(true);
    expect(isSmsDestinationAllowed("+46701234567", dk)).toBe(false);
    expect(isSmsDestinationAllowed("+2347012345678", dk)).toBe(false); // Nigeria (typisk pumping)
    expect(isSmsDestinationAllowed("+46701234567", parseSmsCountries("45, 46,999"))).toBe(true);
    expect(parseSmsCountries("999,abc")).toEqual(["45"]);
  });

  it("lofter pr. nummer og pr. døgn", () => {
    const caps = { perNumberCap: 5, dailyCap: 300 };
    expect(smsCapReached({ sentToNumber: 4, sentTotal: 10, ...caps })).toBeNull();
    expect(smsCapReached({ sentToNumber: 5, sentTotal: 10, ...caps })).toBe("per_number");
    expect(smsCapReached({ sentToNumber: 0, sentTotal: 300, ...caps })).toBe("daily");
  });
});

describeDb("SMS-loft mod databasen (M-5)", () => {
  it("blokerer udland, stopper ved loftet pr. nummer og opretter en alarm", async () => {
    const { prisma } = await import("../db");
    const { smsBlockReason } = await import("./service");
    const settings = { smsCountries: ["45"], smsPerNumberCap: 2, smsDailyCap: 100000 };
    expect(await smsBlockReason("+2347012345678", settings)).toMatch(/Landet/);
    const number = `+459${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    expect(await smsBlockReason(number, settings)).toBeNull();
    const base = { trigger: "test", channel: "SMS" as const, recipientAddress: number, entityType: "test", status: "SENT" as const, sentAt: new Date(), scheduledFor: new Date(), templateKey: "t" };
    const ids = [uid("sms"), uid("sms")];
    await prisma.notificationLog.createMany({ data: ids.map((id) => ({ ...base, id, entityId: id, dedupe: id })) });
    expect(await smsBlockReason(number, settings)).toMatch(/nummer/);
    const alert = await prisma.appSetting.findUnique({ where: { key: "alert:sms_cap_number" } });
    expect(alert).not.toBeNull();
    await prisma.notificationLog.deleteMany({ where: { id: { in: ids } } });
  });
});
