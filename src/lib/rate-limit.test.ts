import { afterAll, describe, expect, it } from "vitest";
import { asAnon, asSystem, asUser, describeDb, uid } from "../test/db";
import { MemoryRateLimitStore, PostgresRateLimitStore, rateLimit, setRateLimitStore, clearRateLimit, storeKey } from "./rate-limit";

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

describeDb("Postgres-lager til rate limits (R-2: nøgle og tid i databasen, bundet til kalderen)", () => {
  afterAll(() => setRateLimitStore(new PostgresRateLimitStore()));

  it("tæller atomisk på tværs af samtidige kald; vinduet styres af databasens tid; nulstilling kun i systemkontekst", async () => {
    const store = new PostgresRateLimitStore();
    const key = `login-ip:${uid("rl")}`;
    // Før login (anon): spande uden identitet (IP, e-mail …) tælles i systemkonteksten af lageret selv
    await asAnon(async () => {
      const counts = await Promise.all(Array.from({ length: 10 }, () => store.hit(key, 60_000)));
      expect(counts.map((c) => c.count).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      // Databasens tid: vinduet slutter ca. 60 s efter nu – et falsk «nu» fra kalderen findes ikke længere
      const until = counts[0].resetAt.getTime();
      expect(Math.abs(until - (Date.now() + 60_000))).toBeLessThan(15_000);
      await store.reset(key);
      expect((await store.hit(key, 60_000)).count).toBe(1);
      await store.reset(key);
    });
  });

  it("spande for kalderens egen identitet tælles i kalderens kontekst – og kun for kalderen selv", async () => {
    const store = new PostgresRateLimitStore();
    const me = uid("user");
    await asUser({ id: me, role: "CUSTOMER" }, async () => {
      expect((await store.hit(`pw-change:${me}`, 60_000)).count).toBe(1);
      await expect(store.hit(`pw-change:${uid("victim")}`, 60_000)).rejects.toThrow(/tilhører ikke kalderen/);
    });
    await asSystem(() => store.reset(`pw-change:${me}`));
  });

  it("gemmer kun hashede nøgler (samme SHA-256 som før)", async () => {
    setRateLimitStore(new PostgresRateLimitStore());
    const { prisma } = await import("./db");
    const email = `${uid("hemmelig")}@test.dk`;
    await asAnon(() => rateLimit(`login-unknown:${email}`, 5));
    const rows = await asSystem(() => prisma.rateLimit.findMany({ where: { key: { contains: "hemmelig" } } }));
    expect(rows).toHaveLength(0);
    expect(await asSystem(() => prisma.rateLimit.count({ where: { key: storeKey(`login-unknown:${email}`) } }))).toBe(1);
    // Uden for systemkontekst er tabellen usynlig (også for en indlogget bruger)
    expect(await asAnon(() => prisma.rateLimit.count())).toBe(0);
    await asAnon(() => clearRateLimit(`login-unknown:${email}`));
    expect(await asSystem(() => prisma.rateLimit.count({ where: { key: storeKey(`login-unknown:${email}`) } }))).toBe(0);
  });
});
