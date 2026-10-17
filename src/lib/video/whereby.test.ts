import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWherebySignature } from "./whereby";

describe("verifyWherebySignature", () => {
  const body = '{"type":"recording.finished"}';
  const t = "1700000000";
  const now = new Date(1700000000 * 1000 + 60_000);
  const sig = createHmac("sha256", "s3cret").update(`${t}.${body}`).digest("hex");
  it("accepterer gyldig signatur", () => {
    expect(verifyWherebySignature(body, `t=${t},v1=${sig}`, "s3cret", now)).toBe(true);
  });
  it("afviser gamle signaturer og løst formaterede headers (L-5)", () => {
    expect(verifyWherebySignature(body, `t=${t},v1=${sig}`, "s3cret", new Date(1700000000 * 1000 + 400_000))).toBe(false);
    expect(verifyWherebySignature(body, `t=${t}, v1=${sig}, x`, "s3cret", now)).toBe(false);
    expect(verifyWherebySignature(body, `t=${t},v1=${sig},foo=bar`, "s3cret", now)).toBe(false);
    expect(verifyWherebySignature(body, `v1=${sig},t=${t},t=${t}`, "s3cret", now)).toBe(false);
  });
  it("afviser forkert signatur/hemmelighed/body", () => {
    expect(verifyWherebySignature(body, `t=${t},v1=${sig}`, "andet", now)).toBe(false);
    expect(verifyWherebySignature(body + " ", `t=${t},v1=${sig}`, "s3cret", now)).toBe(false);
    expect(verifyWherebySignature(body, "", "s3cret", now)).toBe(false);
  });
});
