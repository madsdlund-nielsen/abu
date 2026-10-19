import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import {
  contextParams,
  currentPrincipal,
  DbContextError,
  explicitPrincipal,
  NEXT_WORK_STORE_PROBE,
  runAsPrincipal,
  setRequestPrincipalResolver,
  SYSTEM_REASON_PATTERN,
  withSystemContext,
} from "./db-context";
import { deriveContextKey, signContext } from "./db-context-sign";
import { TRIGGERS } from "./notifications/triggers";

/**
 * Systemkonteksten (`app.role = 'system'`, alle rækker) må kun bruges de steder, der står her – hver med en grep-bar årsag.
 * En ny brug kræver en bevidst ændring af listen (og en begrundelse i README «Row-Level Security»). Request-handlere
 * (sider, server actions, API-ruter) må kun gå i systemkontekst i de få auth-/webhook-/cron-filer nedenfor.
 */
const ALLOW: Record<string, string[]> = {
  // Jobs, cron og scheduler
  "src/lib/jobs.ts": ["jobs.enqueue", "jobs.process"],
  "src/app/api/cron/process-jobs/route.ts": ["cron.complete_meetings"],
  // Webhooks (efter verificeret signatur/hemmelighed)
  "src/app/api/webhooks/payments/route.ts": ["webhooks.payments"],
  "src/app/api/webhooks/video/route.ts": ["webhooks.video"],
  "src/app/api/webhooks/inmobile/route.ts": ["webhooks.inmobile"],
  // Seed og create-admin (kører som ejeren)
  "prisma/seed.ts": ["seed.demo_data"],
  "scripts/create-admin.ts": ["admin.bootstrap"],
  // Auth-internt: opslag før en session findes (login på e-mail, links, MFA for en ventende session, sessioner)
  "src/lib/auth.ts": ["auth.create_session", "auth.password_token"],
  "src/lib/sign-in.ts": ["auth.sign_in", "auth.mfa_complete"],
  "src/app/actions/auth.ts": ["auth.login", "auth.password_reset", "auth.password_reset", "auth.set_password"],
  "src/app/actions/mfa.ts": ["auth.mfa_enrollment"],
  "src/lib/mfa/service.ts": ["auth.mfa_verify", "auth.mfa_enrollment", "auth.mfa_enrollment", "auth.mfa_recovery_codes", "auth.mfa_clear", "auth.trusted_device", "auth.trusted_device"],
  "src/app/actions/onboarding.ts": ["onboarding.account_exists", "onboarding.account_exists", "onboarding.signup"],
  // Token-scoped afmelding (HMAC-link verificeret først)
  "src/app/actions/notifications-public.ts": ["unsubscribe.token_verified"],
  // Notifikationsmotoren (planlægning og afsendelse til alle parter i en hændelse)
  "src/lib/notifications/service.ts": [
    "notifications.defaults",
    "notifications.${label}",
    "notifications.reminders",
    "notifications.onboarding_abandoned",
    "notifications.dispatch",
    "notifications.sms_policy",
    "notifications.deliver",
    "notifications.unsubscribe",
    "notifications.delivery_status",
  ],
  // Systemtabeller (kun system): idempotens-nøgler, CVR-cache, driftsalarmer, rate limits uden identitet (R-2)
  "src/lib/idempotency.ts": ["idempotency.key"],
  "src/lib/rate-limit.ts": ["ratelimit.count", "ratelimit.reset"],
  "src/lib/cvr/index.ts": ["cvr.cache", "cvr.cache"],
  "src/lib/alerts.ts": ["alerts.raise"],
  // Tværgående oprydning og GDPR (efter admins godkendelse / for den indloggede bruger selv)
  "src/lib/onboarding/session.ts": ["onboarding.cleanup_expired", "onboarding.delete_for_email"],
  "src/lib/erasure.ts": ["gdpr.erasure", "gdpr.erasure"],
  "src/lib/data-export.ts": ["gdpr.export"],
  // Testdata (kun tests)
  "src/test/db.ts": ["test.fixtures"],
};

/** Request-handlere, der må gå i systemkontekst (alle andre filer under src/app må ikke). */
const REQUEST_HANDLERS_ALLOWED = Object.keys(ALLOW).filter((f) => f.startsWith("src/app/"));

const root = path.resolve(__dirname, "../..");
function files(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    if (name === "node_modules") return [];
    return statSync(path.join(root, rel)).isDirectory() ? files(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
}
const sources = [...files("src"), ...files("prisma"), ...files("scripts")].filter((f) => !/\.test\.tsx?$/.test(f));

function usages(pattern: RegExp): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of sources) {
    const text = readFileSync(path.join(root, f), "utf8");
    for (const m of text.matchAll(pattern)) (out[f] ??= []).push(m[1] ?? "");
  }
  return out;
}

describe("systemkontekst: allow-list (RLS)", () => {
  const found: Record<string, string[]> = {};
  // Alle kald: "årsag", `skabelon` eller (fejl) et dynamisk udtryk. «withSystemContext(…)» i en fejltekst tæller ikke.
  for (const f of sources) {
    const text = readFileSync(path.join(root, f), "utf8");
    const all = [...text.matchAll(/withSystemContext\(\s*(?:"([^"]*)"|`([^`]*)`|([^,)\s]*))/g)]
      .filter((m) => m[3] !== "…")
      .map((m) => m[1] ?? m[2] ?? `<dynamisk: ${m[3]}>`);
    if (all.length) found[f] = all;
    else delete found[f];
  }
  delete found["src/lib/db-context.ts"]; // definitionen og dokumentationen

  it("hver brug står på listen med netop den årsag – og listen har ingen forældede poster", () => {
    const sort = (o: Record<string, string[]>) => Object.fromEntries(Object.entries(o).sort().map(([k, v]) => [k, [...v].sort()]));
    expect(sort(found)).toEqual(sort(ALLOW));
  });

  it("årsagerne er grep-bare nøgler («område.handling»), og notifikationernes dynamiske årsag er en kendt udløser", () => {
    for (const reasons of Object.values(ALLOW)) for (const r of reasons) if (!r.includes("${")) expect(r).toMatch(SYSTEM_REASON_PATTERN);
    const service = readFileSync(path.join(root, "src/lib/notifications/service.ts"), "utf8");
    const labels = [...service.matchAll(/safely\(\s*"([^"]+)"/g), ...service.matchAll(/safely\(trigger,/g)].map((m) => m[1] ?? "trigger");
    expect(labels.length).toBeGreaterThan(5);
    for (const l of labels.filter((x) => x !== "trigger")) expect(Object.keys(TRIGGERS)).toContain(l);
  });

  it("request-handlere (sider, layouts, server actions, API-ruter) går kun i systemkontekst i de godkendte filer", () => {
    const handlers = Object.keys(found).filter((f) => f.startsWith("src/app/"));
    expect(handlers.sort()).toEqual(REQUEST_HANDLERS_ALLOWED.sort());
    expect(handlers.filter((f) => /\/(page|layout)\.tsx$/.test(f))).toEqual([]);
  });

  it("runAsPrincipal (en bestemt bruger) kun i auth.ts' sessionsopslag; testens resolver kun i tests", () => {
    expect(Object.keys(usages(/runAsPrincipal\((\w*)/g)).filter((f) => f !== "src/lib/db-context.ts").sort()).toEqual(["src/lib/auth.ts", "src/test/db.ts"]);
    expect(Object.keys(usages(/setRequestPrincipalResolver\((\w*)/g)).filter((f) => f !== "src/lib/db-context.ts")).toEqual([]);
  });

  it("ingen array-transaktioner og ingen usikre rå forespørgsler i koden", () => {
    expect(Object.keys(usages(/\$transaction\(\s*(\[)/g)).filter((f) => f !== "src/lib/db.ts")).toEqual([]);
    expect(Object.keys(usages(/\$(queryRawUnsafe|executeRawUnsafe)\(/g))).toEqual([]);
  });
});

describe("databasekontekst (AsyncLocalStorage)", () => {
  it("withSystemContext kræver en årsag og gælder kun inde i funktionen", async () => {
    await expect(withSystemContext("", async () => 1)).rejects.toBeInstanceOf(DbContextError);
    await expect(withSystemContext("System", async () => 1)).rejects.toBeInstanceOf(DbContextError);
    expect(explicitPrincipal()).toBeUndefined();
    const inside = await withSystemContext("test.unit", async () => {
      await new Promise((r) => setTimeout(r, 1));
      return explicitPrincipal();
    });
    expect(inside).toEqual({ userId: null, role: "system", reason: "test.unit" });
    expect(explicitPrincipal()).toBeUndefined();
  });

  it("runAsPrincipal afviser system og roller uden bruger-id; indlejrede kontekster gendannes", async () => {
    await expect(runAsPrincipal({ userId: null, role: "system" }, async () => 1)).rejects.toBeInstanceOf(DbContextError);
    await expect(runAsPrincipal({ userId: null, role: "CUSTOMER" }, async () => 1)).rejects.toBeInstanceOf(DbContextError);
    const seen = await runAsPrincipal({ userId: "u1", role: "CUSTOMER" }, async () => {
      const inner = await withSystemContext("test.unit", async () => (await currentPrincipal())?.role);
      return [inner, (await currentPrincipal())?.userId];
    });
    expect(seen).toEqual(["system", "u1"]);
  });

  it("parallelle kontekster blandes ikke", async () => {
    const roles = await Promise.all(
      (["ADMIN", "ADVISOR", "CUSTOMER"] as const).map((role, i) =>
        runAsPrincipal({ userId: `u${i}`, role }, async () => {
          await new Promise((r) => setTimeout(r, 5 - i));
          return (await currentPrincipal())?.role;
        }),
      ),
    );
    expect(roles).toEqual(["ADMIN", "ADVISOR", "CUSTOMER"]);
  });

  it("uden kontekst og uden request er der ingen principal (fail closed)", async () => {
    setRequestPrincipalResolver(async () => null);
    try {
      expect(await currentPrincipal()).toBeNull();
    } finally {
      setRequestPrincipalResolver(null);
    }
  });
});

describe("Prisma-udvidelsen og adapter-vagten (uden database)", () => {
  it("en forespørgsel uden kontekst afvises, før der sendes noget til databasen", async () => {
    const { createPrismaClient } = await import("./db");
    const db = createPrismaClient("postgresql://abu_app@127.0.0.1:1/ingen");
    setRequestPrincipalResolver(async () => null);
    try {
      await expect(db.user.findMany()).rejects.toBeInstanceOf(DbContextError);
      await expect(db.$queryRaw`SELECT 1`).rejects.toBeInstanceOf(DbContextError);
      await expect(db.$transaction(async () => 1)).rejects.toBeInstanceOf(DbContextError);
      // Array-transaktioner kan ikke få en kontekst foran sig og afvises altid
      await expect(withSystemContext("test.unit", () => db.$transaction([db.user.count()] as never))).rejects.toThrow(/interaktiv transaktion/);
    } finally {
      setRequestPrincipalResolver(null);
      await db.$disconnect();
    }
  });

  it("vagten afviser sætninger uden for en transaktion og transaktioner, der ikke starter med konteksten", async () => {
    const { guardAdapterFactory, SET_CONTEXT_SQL_PREFIX } = await import("./db");
    type Q = { sql: string; args: unknown[] };
    const sent: string[] = [];
    const tx = { queryRaw: async (q: Q) => sent.push(q.sql), executeRaw: async (q: Q) => sent.push(q.sql), commit: async () => {} };
    const adapter = { queryRaw: async (q: Q) => q.sql.length, executeRaw: async (q: Q) => q.sql.length, startTransaction: async () => ({ ...tx }) };
    const factory = guardAdapterFactory({ connect: async () => adapter });
    const a = await factory.connect();
    await expect(a.queryRaw({ sql: "SELECT 1", args: [] })).rejects.toBeInstanceOf(DbContextError);
    await expect(a.executeRaw({ sql: "DELETE FROM x", args: [] })).rejects.toBeInstanceOf(DbContextError);
    const bad = await a.startTransaction();
    expect(() => bad.queryRaw({ sql: 'SELECT * FROM "User"', args: [] })).toThrow(DbContextError);
    const empty = await a.startTransaction();
    expect(() => empty.executeRaw({ sql: `${SET_CONTEXT_SQL_PREFIX}, $1, true)`, args: ["", "", "", ""] })).toThrow(DbContextError); // ingen rolle
    const good = await a.startTransaction();
    await good.executeRaw({ sql: `${SET_CONTEXT_SQL_PREFIX}, $1, true)`, args: ["u1", "CUSTOMER", "", ""] });
    await good.queryRaw({ sql: 'SELECT * FROM "Meeting"', args: [] });
    await good.executeRaw({ sql: "COMMIT", args: [] });
    expect(sent).toEqual([`${SET_CONTEXT_SQL_PREFIX}, $1, true)`, 'SELECT * FROM "Meeting"', "COMMIT"]);
  });
});

describe("N-1: request-principalen (Next.js' work store) er fail-closed", () => {
  it("Next.js' work store: modulet findes og har getStore/run, og Next er den låste major (fejler højt ved en opgradering)", async () => {
    // Afhængigheden af en intern Next-API er bevidst (db-context.ts). Flytter eller ændrer modulet sig, fejler denne
    // test – og db-context.ts kaster DbContextError i stedet for stille at miste huskningen pr. request.
    expect(NEXT_WORK_STORE_PROBE.ok).toBe(true);
    expect(typeof workAsyncStorage.getStore).toBe("function");
    expect(typeof workAsyncStorage.run).toBe("function");
    const pkg = JSON.parse(readFileSync(path.join(root, "node_modules/next/package.json"), "utf8")) as { version: string };
    expect(pkg.version.split(".")[0]).toBe("16");
    // Samme objekt som Next selv bruger (cookies-adapteren læser workAsyncStorage fra samme .external-modul)
    const adapter = readFileSync(path.join(root, "node_modules/next/dist/server/web/spec-extension/adapters/request-cookies.js"), "utf8");
    expect(adapter).toContain("work-async-storage.external");
  });

  it("hver admin-side kræver selv ADMIN (layout og side renderes parallelt – layoutets tjek beskytter ikke sidens forespørgsler)", () => {
    const pages = files("src/app/admin").filter((f) => f.endsWith("/page.tsx"));
    expect(pages.length).toBeGreaterThan(10);
    const missing = pages.filter((f) => !/export default async function \w+\([^)]*\)?[^{]*\{\s*(\/\/[^\n]*\n\s*)*await requireRole\("ADMIN"\);/.test(readFileSync(path.join(root, f), "utf8")));
    expect(missing).toEqual([]);
  });
});

describe("signeret databasekontekst (app.ctx)", () => {
  it("contextParams signerer de fire værdier; signaturen afhænger af hver værdi og har ny nonce pr. transaktion", () => {
    const p = contextParams({ userId: "u1", role: "CUSTOMER", sessionId: "s", onboardingToken: null });
    expect(p.slice(0, 4)).toEqual(["u1", "CUSTOMER", "s", ""]);
    expect(p[4]).toMatch(/^[0-9a-f]{16}\.\d+\.[0-9a-f]{24}\.[0-9a-f]{64}$/);
    expect(contextParams({ userId: "u1", role: "CUSTOMER" })[4]).not.toBe(contextParams({ userId: "u1", role: "CUSTOMER" })[4]);
    const k = deriveContextKey("test-secret-0123456789abcdef0123456789");
    const sig = (v: [string, string, string, string]) => signContext(v, k, 1_000, "00".repeat(12)).split(".")[3];
    const base = sig(["u1", "CUSTOMER", "", ""]);
    expect(sig(["u1", "system", "", ""])).not.toBe(base);
    expect(sig(["u2", "CUSTOMER", "", ""])).not.toBe(base);
    expect(sig(["u1", "CUSTOMER", "x", ""])).not.toBe(base);
    expect(sig(["u1", "CUSTOMER", "", "x"])).not.toBe(base);
    expect(() => signContext(["u1|x", "CUSTOMER", "", ""], k)).toThrow(/«\|»/);
  });
});
