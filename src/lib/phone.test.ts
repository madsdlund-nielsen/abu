import { describe, expect, it } from "vitest";
import { formatPhone, toE164 } from "./phone";

describe("toE164", () => {
  it("normaliserer danske numre", () => {
    expect(toE164("20 30 40 50")).toBe("+4520304050");
    expect(toE164("+45 20 30 40 50")).toBe("+4520304050");
    expect(toE164("0045 2030 4050")).toBe("+4520304050");
    expect(toE164("(+45) 20-30-40-50")).toBe("+4520304050");
  });
  it("accepterer udenlandske numre med landekode", () => {
    expect(toE164("+46 70 123 45 67")).toBe("+46701234567");
    expect(toE164("0046701234567")).toBe("+46701234567");
  });
  it("afviser ugyldige", () => {
    for (const v of [null, undefined, "", "123", "abc", "2030405", "070 123 45 67", "+45 2030 405"]) expect(toE164(v as string), String(v)).toBeNull();
  });
  it("formaterer til visning", () => {
    expect(formatPhone("+4520304050")).toBe("+45 20 30 40 50");
    expect(formatPhone("+46701234567")).toBe("+46701234567");
  });
});
