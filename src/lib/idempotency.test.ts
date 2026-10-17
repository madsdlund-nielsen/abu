import { describe, expect, it, vi } from "vitest";
import { describeDb, uid } from "../test/db";
import { idempotencyId, isValidIdempotencyKey } from "./idempotency";

describe("idempotens-nøgler (QA #1)", () => {
  it("accepterer UUID'er og afviser tomme/ugyldige nøgler", () => {
    expect(isValidIdempotencyKey("3f2b8c1e-9a4d-4f7e-8b2a-1c5d6e7f8a9b")).toBe(true);
    expect(isValidIdempotencyKey("")).toBe(false);
    expect(isValidIdempotencyKey("kort")).toBe(false);
    expect(isValidIdempotencyKey("a b c d e f g h i j k l m")).toBe(false);
    expect(isValidIdempotencyKey(null)).toBe(false);
  });
  it("binder nøglen til bruger og handling", () => {
    const k = "3f2b8c1e-9a4d-4f7e-8b2a-1c5d6e7f8a9b";
    expect(idempotencyId("u1", "booking", k)).not.toBe(idempotencyId("u2", "booking", k));
    expect(idempotencyId("u1", "booking", k)).not.toBe(idempotencyId("u1", "advisor.create", k));
  });
});

describeDb("withIdempotency mod databasen (QA #1)", () => {
  it("udfører handlingen én gang ved samtidige/gentagne kald og giver samme resultat", async () => {
    const { withIdempotency } = await import("./idempotency");
    const key = crypto.randomUUID();
    const user = uid("u");
    let n = 0;
    const fn = vi.fn(async () => {
      n++;
      await new Promise((r) => setTimeout(r, 200));
      return { ok: true, meetingId: `m${n}` };
    });
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => withIdempotency({ userId: user, scope: "booking", key }, fn)));
    expect(fn).toHaveBeenCalledTimes(1);
    expect([a.result, b.result, c.result]).toEqual([{ ok: true, meetingId: "m1" }, { ok: true, meetingId: "m1" }, { ok: true, meetingId: "m1" }]);
    expect([a, b, c].filter((x) => x.replayed)).toHaveLength(2);
    // Senere gentagelse (fx genindsendt formular) får også det første resultat
    expect((await withIdempotency({ userId: user, scope: "booking", key }, fn)).result).toEqual({ ok: true, meetingId: "m1" });
    expect(fn).toHaveBeenCalledTimes(1);
    // Anden bruger med samme nøgle er uafhængig
    await withIdempotency({ userId: uid("u"), scope: "booking", key }, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("frigiver nøglen ved en uventet fejl, så et nyt forsøg kan køre", async () => {
    const { withIdempotency } = await import("./idempotency");
    const key = crypto.randomUUID();
    const user = uid("u");
    await expect(withIdempotency({ userId: user, scope: "x", key }, async () => { throw new Error("netværk"); })).rejects.toThrow("netværk");
    expect((await withIdempotency({ userId: user, scope: "x", key }, async () => ({ ok: true }))).result).toEqual({ ok: true });
  });
});
