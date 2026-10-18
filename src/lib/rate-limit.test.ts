import { afterAll, describe, expect, it } from "vitest";
import { asAnon, asSystem, describeDb, uid } from "../test/db";
import { MemoryRateLimitStore, PostgresRateLimitStore, rateLimit, setRateLimitStore, clearRateLimit } from "./rate-limit";

const t0 = new Date("2026-10-17T10:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

describe("rate limit (H-2/L-2)", () => {
  it("tillader max forsøg pr. vindue og starter forfra efter vinduet", async () => {
    setRateLimitStore(new MemoryRateLimitStore());
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await rateLimit("k", 3, 60_000, at(i)));
    expect(results).toEqual([true, true, true, false, false]);
    expect(await rateLimit("k", 3, 60_000, at(60_001))).toBe(true);
    expect(await rateLimit("andet", 3, 60_000, at(0))).toBe(true);
    await clearRateLimit("k");
    expect(await rateLimit("k", 1, 60_000, at(60_002))).toBe(true);
  });
});

describeDb("Postgres-lager til rate limits", () => {
  afterAll(() => setRateLimitStore(new PostgresRateLimitStore()));

  it("tæller atomisk på tværs af samtidige kald og nulstiller efter vinduet", async () => {
    const store = new PostgresRateLimitStore();
    const key = uid("rl");
    // Også før login (anon): lageret går gennem rls.rate_limit_hit/rate_limit_reset
    await asAnon(async () => {
      const counts = await Promise.all(Array.from({ length: 10 }, () => store.hit(key, 60_000, t0)));
      expect(counts.map((c) => c.count).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const after = await store.hit(key, 60_000, at(60_001));
      expect(after.count).toBe(1);
      expect(after.resetAt.getTime()).toBe(at(120_001).getTime());
      await store.reset(key);
      expect((await store.hit(key, 60_000, at(60_002))).count).toBe(1);
      await store.reset(key);
    });
  });

  it("gemmer kun hashede nøgler", async () => {
    setRateLimitStore(new PostgresRateLimitStore());
    const { prisma } = await import("./db");
    const email = `${uid("hemmelig")}@test.dk`;
    await asAnon(() => rateLimit(`login-unknown:${email}`, 5));
    const rows = await asSystem(() => prisma.rateLimit.findMany({ where: { key: { contains: "hemmelig" } } }));
    expect(rows).toHaveLength(0);
    // Uden for systemkontekst er tabellen usynlig (også for en indlogget bruger)
    expect(await asAnon(() => prisma.rateLimit.count())).toBe(0);
    await asAnon(() => clearRateLimit(`login-unknown:${email}`));
  });
});
