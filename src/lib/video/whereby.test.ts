import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWherebySignature } from "./whereby";

describe("verifyWherebySignature", () => {
  const body = '{"type":"recording.finished"}';
  const t = "1700000000";
  const sig = createHmac("sha256", "s3cret").update(`${t}.${body}`).digest("hex");
  it("accepterer gyldig signatur", () => {
    expect(verifyWherebySignature(body, `t=${t},v1=${sig}`, "s3cret")).toBe(true);
  });
  it("afviser forkert signatur/hemmelighed/body", () => {
    expect(verifyWherebySignature(body, `t=${t},v1=${sig}`, "andet")).toBe(false);
    expect(verifyWherebySignature(body + " ", `t=${t},v1=${sig}`, "s3cret")).toBe(false);
    expect(verifyWherebySignature(body, "", "s3cret")).toBe(false);
  });
});
