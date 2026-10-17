import { describe, expect, it } from "vitest";
import { computeSignature, parseWebhookTimestamp, signWebhook, verifyWebhookSignature, type SignatureScheme } from "../webhooks/signature";
import { PAYMENT_WEBHOOK_SCHEME as S } from "./frisbii-signature";

const secret = "whsec_test";
const now = new Date("2026-10-17T12:00:00Z");
const ts = String(Math.floor(now.getTime() / 1000));
const body = JSON.stringify({ id: "evt_1", event_type: "subscription_created", subscription: "sub_1", timestamp: now.toISOString() });

describe("betalingswebhook: HMAC over rå body + tidsstempel (H-4)", () => {
  it("accepterer en korrekt signeret, frisk begivenhed", () => {
    const r = verifyWebhookSignature(S, body, signWebhook(S, body, secret, ts), secret, now);
    expect(r).toEqual({ ok: true, timestamp: new Date(Number(ts) * 1000) });
  });

  it("afviser en manipuleret body (fx andet abonnement eller begivenhed)", () => {
    const headers = signWebhook(S, body, secret, ts);
    const tampered = body.replace("sub_1", "sub_2");
    expect(verifyWebhookSignature(S, tampered, headers, secret, now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyWebhookSignature(S, body.replace("subscription_created", "subscription_cancelled"), headers, secret, now)).toMatchObject({ ok: false });
    expect(verifyWebhookSignature(S, body + " ", headers, secret, now)).toMatchObject({ ok: false });
  });

  it("afviser gamle og fremtidige tidsstempler (> 5 min)", () => {
    const old = String(Number(ts) - 301);
    expect(verifyWebhookSignature(S, body, signWebhook(S, body, secret, old), secret, now)).toEqual({ ok: false, reason: "stale" });
    const future = String(Number(ts) + 301);
    expect(verifyWebhookSignature(S, body, signWebhook(S, body, secret, future), secret, now)).toEqual({ ok: false, reason: "future" });
    const fine = String(Number(ts) - 299);
    expect(verifyWebhookSignature(S, body, signWebhook(S, body, secret, fine), secret, now).ok).toBe(true);
  });

  it("afviser et tidsstempel, der er byttet ud (det er en del af det signerede)", () => {
    const h = signWebhook(S, body, secret, String(Number(ts) - 3600));
    const sig = h[S.header].split("v1=")[1];
    expect(verifyWebhookSignature(S, body, { [S.header]: `t=${ts},v1=${sig}` }, secret, now)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("afviser forkert hemmelighed, tom hemmelighed og manglende/forkert header", () => {
    expect(verifyWebhookSignature(S, body, signWebhook(S, body, "andet", ts), secret, now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyWebhookSignature(S, body, signWebhook(S, body, secret, ts), "", now)).toEqual({ ok: false, reason: "missing_secret" });
    expect(verifyWebhookSignature(S, body, {}, secret, now)).toEqual({ ok: false, reason: "missing_header" });
    expect(verifyWebhookSignature(S, body, { [S.header]: "v1=abc" }, secret, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyWebhookSignature(S, body, { [S.header]: `t=${ts},t=${ts},v1=${"a".repeat(64)}` }, secret, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyWebhookSignature(S, body, { [S.header]: `t=${ts},v1=xyz` }, secret, now)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyWebhookSignature(S, body, { [S.header]: `t=igår,v1=${"a".repeat(64)}` }, secret, now)).toEqual({ ok: false, reason: "bad_timestamp" });
  });

  it("tillader flere v1 (nøglerotation), og virker med Headers-objekt", () => {
    const good = computeSignature(S, ts, body, secret);
    const headers = new Headers({ "Frisbii-Signature": `t=${ts},v1=${"0".repeat(64)},v1=${good}` });
    expect(verifyWebhookSignature(S, body, headers, secret, now).ok).toBe(true);
  });

  it("kan tilpasses et andet skema (separat header, base64, ISO-tidsstempel)", () => {
    const alt: SignatureScheme = { header: "x-signature", format: { kind: "separate", timestampHeader: "x-timestamp" }, payload: (t, b) => t + b, encoding: "base64", toleranceSeconds: 300 };
    const iso = now.toISOString();
    const h = signWebhook(alt, body, secret, iso);
    expect(verifyWebhookSignature(alt, body, h, secret, now).ok).toBe(true);
    expect(verifyWebhookSignature(alt, body + "x", h, secret, now).ok).toBe(false);
  });

  it("forstår unix-sekunder, -millisekunder og ISO", () => {
    expect(parseWebhookTimestamp("1700000000")?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(parseWebhookTimestamp("1700000000000")?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(parseWebhookTimestamp("2026-01-05T10:00:00.000+00:00")?.toISOString()).toBe("2026-01-05T10:00:00.000Z");
    expect(parseWebhookTimestamp("17000")).toBeNull();
  });
});
