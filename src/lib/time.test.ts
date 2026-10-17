import { describe, expect, it } from "vitest";
import { formatDanishDateInput, parseDanishDate, parseDanishDateTime } from "./time";

describe("parseDanishDate", () => {
  it("læser dd.mm.åååå og varianter", () => {
    expect(parseDanishDate("19.10.2026")).toEqual({ y: 2026, m: 10, d: 19 });
    expect(parseDanishDate("1.2.2027")).toEqual({ y: 2027, m: 2, d: 1 });
    expect(parseDanishDate(" 05/03/2026 ")).toEqual({ y: 2026, m: 3, d: 5 });
  });
  it("afviser ugyldige datoer og amerikansk/ISO-format", () => {
    expect(parseDanishDate("31.02.2026")).toBeNull();
    expect(parseDanishDate("29.02.2026")).toBeNull();
    expect(parseDanishDate("29.02.2028")).toEqual({ y: 2028, m: 2, d: 29 });
    expect(parseDanishDate("13.13.2026")).toBeNull();
    expect(parseDanishDate("2026-10-19")).toBeNull();
    expect(parseDanishDate("")).toBeNull();
  });
});

describe("parseDanishDateTime (Europe/Copenhagen)", () => {
  it("bruger sommertid (UTC+2) i oktober før omstilling", () => {
    expect(parseDanishDateTime("19.10.2026", "09:30")?.toISOString()).toBe("2026-10-19T07:30:00.000Z");
  });
  it("bruger vintertid (UTC+1) efter omstilling", () => {
    expect(parseDanishDateTime("02.11.2026", "09:30")?.toISOString()).toBe("2026-11-02T08:30:00.000Z");
  });
  it("afviser ugyldigt input", () => {
    expect(parseDanishDateTime("19.10.2026", "25:00")).toBeNull();
    expect(parseDanishDateTime("19.10.2026", "24:00")).toBeNull();
    expect(parseDanishDateTime("xx", "09:00")).toBeNull();
  });
  it("formaterer til dd.mm.åååå", () => {
    expect(formatDanishDateInput(new Date("2026-10-19T07:30:00Z"))).toBe("19.10.2026");
  });
});
