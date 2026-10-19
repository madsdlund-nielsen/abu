import { describe, expect, it, vi } from "vitest";

// Next-serveren sætter globalThis.AsyncLocalStorage, før dens interne work store oprettes; uden den er storen en
// attrap, der ikke kan køre. Som i Next: sæt den, før modulerne indlæses (vi.hoisted kører før importerne).
vi.hoisted(() => {
  const g = globalThis as { AsyncLocalStorage?: unknown };
  g.AsyncLocalStorage ??= process.getBuiltinModule("node:async_hooks").AsyncLocalStorage;
});

import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { currentPrincipal, DbContextError, setRequestPrincipal, setRequestPrincipalResolver } from "./db-context";

/** N-1: request-principalen huskes på Next.js' work store (samme objekt i layout, side og server action). */
describe("N-1: request-principalen i en (simuleret) Next-request", () => {
  it("i en request huskes principalen; et skift midt i requesten uden login/logud kaster DbContextError", async () => {
    const store = {};
    const full = { userId: "admin1", role: "ADMIN" as const, sessionId: "s1" };
    await workAsyncStorage.run(store as never, async () => {
      setRequestPrincipal(full);
      expect(await currentPrincipal()).toEqual(full);
      // Samme principal igen (fx et nyt sessionsopslag) er fint
      setRequestPrincipal({ ...full, onboardingToken: null });
      // En fuld session må ikke stille blive til anon midt i requesten (det N-1 så i loggen)
      expect(() => setRequestPrincipal({ userId: null, role: "anon", sessionId: null })).toThrow(DbContextError);
      expect(await currentPrincipal()).toEqual({ ...full, onboardingToken: null });
      // Logud (transition) må gerne
      setRequestPrincipal({ userId: null, role: "anon", sessionId: null }, { transition: true });
      expect((await currentPrincipal())?.role).toBe("anon");
    });
    // Uden for en request er der ingen huskning (og intet at skifte)
    expect(() => setRequestPrincipal(full)).not.toThrow();
  });

  it("parallelle forespørgsler i samme request deler én opslået principal", async () => {
    let calls = 0;
    setRequestPrincipalResolver(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return { userId: "a1", role: "ADMIN" };
    });
    try {
      const roles = await workAsyncStorage.run({} as never, () => Promise.all(Array.from({ length: 12 }, async () => (await currentPrincipal())?.role)));
      expect(roles).toEqual(Array(12).fill("ADMIN"));
      expect(calls).toBe(1);
    } finally {
      setRequestPrincipalResolver(null);
    }
  });

});
