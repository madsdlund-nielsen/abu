import { describe, expect, it } from "vitest";
import { adjustForQuietHours, describeTiming, formatQuietHours, isQuiet, nextAllowed, offsetToParts, parseQuietHours, partsToOffset, validateOffset } from "./timing";
import { formatTime, localDateKey } from "../time";

const q = parseQuietHours("21-08")!;
const at = (iso: string) => new Date(iso);

describe("timing: offsets", () => {
  it("omregner mellem minutter og (antal + enhed + før/efter)", () => {
    expect(partsToOffset({ amount: 24, unit: "hours", direction: "before" })).toBe(-1440);
    expect(partsToOffset({ amount: 3, unit: "days", direction: "after" })).toBe(4320);
    expect(partsToOffset({ amount: 0, unit: "minutes", direction: "after" })).toBe(0);
    expect(offsetToParts(-1440)).toEqual({ amount: 24, unit: "hours", direction: "before" });
    expect(offsetToParts(4320)).toEqual({ amount: 3, unit: "days", direction: "after" });
    expect(offsetToParts(-90)).toEqual({ amount: 90, unit: "minutes", direction: "before" });
    expect(offsetToParts(1440)).toEqual({ amount: 24, unit: "hours", direction: "after" });
  });
  it("beskriver timing på dansk", () => {
    expect(describeTiming("before_start", -1440)).toBe("24 timer før mødets start");
    expect(describeTiming("before_start", -60)).toBe("1 time før mødets start");
    expect(describeTiming("before_start", -30)).toBe("30 minutter før mødets start");
    expect(describeTiming("event", 0)).toBe("Straks");
    expect(describeTiming("after_activity", 60)).toBe("1 time efter sidste aktivitet");
    expect(describeTiming("after_activity", 4320)).toBe("3 dage efter sidste aktivitet");
  });
  it("validerer retning", () => {
    expect(validateOffset("before_start", -60)).toBeNull();
    expect(validateOffset("before_start", 10)).toMatch(/før/);
    expect(validateOffset("event", -5)).toMatch(/efter/);
    expect(validateOffset("event", 0)).toBeNull();
    expect(validateOffset("event", 61 * 1440)).toMatch(/60 dage/);
  });
});

describe("timing: stille timer", () => {
  it("parser og formaterer", () => {
    expect(q).toEqual({ startHour: 21, endHour: 8 });
    expect(parseQuietHours("off")).toBeNull();
    expect(parseQuietHours("")).toBeNull();
    expect(parseQuietHours("8-8")).toBeNull();
    expect(parseQuietHours("25-8")).toBeNull();
    expect(formatQuietHours(q)).toBe("21-08");
    expect(formatQuietHours(null)).toBe("off");
  });
  it("21-08 er stille om natten, i København-tid", () => {
    expect(isQuiet(at("2026-11-12T19:59:00Z"), q)).toBe(false); // 20:59 CET
    expect(isQuiet(at("2026-11-12T20:00:00Z"), q)).toBe(true); // 21:00
    expect(isQuiet(at("2026-11-13T06:59:00Z"), q)).toBe(true); // 07:59
    expect(isQuiet(at("2026-11-13T07:00:00Z"), q)).toBe(false); // 08:00
    expect(isQuiet(at("2026-06-18T18:59:00Z"), q)).toBe(false); // 20:59 CEST
    expect(isQuiet(at("2026-06-18T19:00:00Z"), q)).toBe(true); // 21:00 CEST
  });
  it("nextAllowed giver kl. 08:00 lokal tid, også efter midnat og over sommertid", () => {
    const late = nextAllowed(at("2026-11-12T22:30:00Z"), q); // 23:30 CET
    expect(localDateKey(late)).toBe("2026-11-13");
    expect(formatTime(late)).toBe("08:00");
    const early = nextAllowed(at("2026-11-13T02:00:00Z"), q); // 03:00 CET
    expect(localDateKey(early)).toBe("2026-11-13");
    expect(formatTime(early)).toBe("08:00");
    expect(formatTime(nextAllowed(at("2026-06-18T21:30:00Z"), q))).toBe("08:00"); // 23:30 CEST
    expect(nextAllowed(at("2026-11-12T12:00:00Z"), q).getTime()).toBe(at("2026-11-12T12:00:00Z").getTime());
  });
  it("tegn på sommertid: natten 28.-29. marts (skift 02:00 → 03:00)", () => {
    const n = nextAllowed(at("2026-03-29T00:30:00Z"), q); // 01:30 CET
    expect(localDateKey(n)).toBe("2026-03-29");
    expect(formatTime(n)).toBe("08:00");
  });
  it("kun SMS med stille-timer-regel udsættes", () => {
    const night = at("2026-11-12T22:00:00Z"); // 23:00 CET
    expect(adjustForQuietHours({ at: night, channel: "EMAIL", ruleQuiet: true, quiet: q }).delayed).toBe(false);
    expect(adjustForQuietHours({ at: night, channel: "SMS", ruleQuiet: false, quiet: q }).delayed).toBe(false);
    expect(adjustForQuietHours({ at: night, channel: "SMS", ruleQuiet: true, quiet: null }).delayed).toBe(false);
    const r = adjustForQuietHours({ at: night, channel: "SMS", ruleQuiet: true, quiet: q });
    expect(r.delayed).toBe(true);
    expect(formatTime(r.at!)).toBe("08:00");
  });
  it("undtagelse: påmindelser under 2 timer før mødet sendes uanset stille timer", () => {
    const start = at("2026-11-13T07:30:00Z"); // 08:30
    const r = adjustForQuietHours({ at: at("2026-11-13T06:30:00Z"), channel: "SMS", ruleQuiet: true, quiet: q, meetingStart: start }); // 07:30, 60 min før
    expect(r).toEqual({ at: at("2026-11-13T06:30:00Z"), delayed: false });
    // præcis 2 timer før er ikke undtaget
    const r2 = adjustForQuietHours({ at: at("2026-11-13T05:30:00Z"), channel: "SMS", ruleQuiet: true, quiet: q, meetingStart: start });
    expect(r2.delayed).toBe(true);
  });
  it("springer over, hvis udsættelsen rækker til mødets start", () => {
    // Møde kl. 07:00 (06:00Z). En SMS 3 timer før (04:00Z = 05:00 lokal) ville blive udsat til 08:00, efter mødet.
    const r = adjustForQuietHours({ at: at("2026-11-13T04:00:00Z"), channel: "SMS", ruleQuiet: true, quiet: q, meetingStart: at("2026-11-13T06:00:00Z") });
    expect(r.at).toBeNull();
  });
});
