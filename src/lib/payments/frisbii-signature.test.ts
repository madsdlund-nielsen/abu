import { describe, expect, it } from "vitest";
import { computeFrisbiiSignature, verifyFrisbiiSignature } from "./frisbii-signature";

const secret = "whsec_test";
const id = "evt_123";
const timestamp = "2026-01-05T10:00:00.000+00:00";

describe("verifyFrisbiiSignature", () => {
  it("accepterer korrekt signatur", () => {
    const signature = computeFrisbiiSignature(timestamp, id, secret);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyFrisbiiSignature({ id, timestamp, signature }, secret)).toBe(true);
  });
  it("afviser forkert hemmelighed", () => {
    const signature = computeFrisbiiSignature(timestamp, id, "andet");
    expect(verifyFrisbiiSignature({ id, timestamp, signature }, secret)).toBe(false);
  });
  it("afviser ændret id eller timestamp", () => {
    const signature = computeFrisbiiSignature(timestamp, id, secret);
    expect(verifyFrisbiiSignature({ id: "evt_999", timestamp, signature }, secret)).toBe(false);
    expect(verifyFrisbiiSignature({ id, timestamp: "x", signature }, secret)).toBe(false);
  });
  it("afviser manglende felter, forkert længde og tom hemmelighed", () => {
    expect(verifyFrisbiiSignature({ id, timestamp }, secret)).toBe(false);
    expect(verifyFrisbiiSignature({ id, timestamp, signature: "abc" }, secret)).toBe(false);
    const signature = computeFrisbiiSignature(timestamp, id, secret);
    expect(verifyFrisbiiSignature({ id, timestamp, signature }, "")).toBe(false);
  });
});
