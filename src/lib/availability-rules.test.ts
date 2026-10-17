import { describe, expect, it } from "vitest";
import { overlapsExistingRule } from "./availability-rules";

const existing = [{ weekday: 6, startMinute: 600, endMinute: 720 }];

describe("overlapsExistingRule", () => {
  it("afviser dublet og delvist overlap på samme ugedag", () => {
    expect(overlapsExistingRule(existing, { weekday: 6, startMinute: 600, endMinute: 720 })).toBe(true);
    expect(overlapsExistingRule(existing, { weekday: 6, startMinute: 660, endMinute: 780 })).toBe(true);
    expect(overlapsExistingRule(existing, { weekday: 6, startMinute: 540, endMinute: 630 })).toBe(true);
    expect(overlapsExistingRule(existing, { weekday: 6, startMinute: 610, endMinute: 700 })).toBe(true);
  });
  it("tillader tilstødende tidsrum og andre ugedage", () => {
    expect(overlapsExistingRule(existing, { weekday: 6, startMinute: 720, endMinute: 780 })).toBe(false);
    expect(overlapsExistingRule(existing, { weekday: 6, startMinute: 540, endMinute: 600 })).toBe(false);
    expect(overlapsExistingRule(existing, { weekday: 7, startMinute: 600, endMinute: 720 })).toBe(false);
  });
});
