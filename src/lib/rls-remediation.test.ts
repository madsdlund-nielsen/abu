import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { asSystem, describeDb, ownerDb, rawAsApp, uid } from "../test/db";
import { cookieJar } from "../test/request";
import { contextParams, dbContextKey } from "./db-context";
import { deriveContextKey, signContext } from "./db-context-sign";
import { sha256 } from "./tokens";

vi.mock("next/headers", async () => (await import("../test/request")).nextHeadersMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));

/**
 * Adversariale tests for fundene i docs/SECURITY-AUDIT-MFA-RLS.md – rapportens egne beviser (rå SQL som abu_app, som en
 * SQL-injektion) gentaget mod de nye migrationer, og vist at de nu fejler:
 *   M-1 lead/samtykke-overtagelse · M-2 audit-forfalskning · R-1 inaktiv rådgiver i eget board · R-2 rate limit for andre ·
 *   R-3 ubegrænset kalendervindue · R-4 opsagte boards · forfalsket systemkontekst (set_config('app.role','system')).
 */

type World = Awaited<ReturnType<typeof seed>>;

const soon = (days: number) => new Date(Date.now() + days * 86_400_000);

async function seed() {
  const { prisma } = await import("./db");
  const { getLeadTagId } = await import("./lead");
  return asSystem(async () => {
    const mk = (role: "ADMIN" | "ADVISOR" | "CUSTOMER", name: string, extra: object = {}) =>
      prisma.user.create({ data: { email: `${uid(role.toLowerCase())}@rem.test`, name, role, ...extra } });
    const admin = await mk("ADMIN", "Rem Admin");
    const shared = await mk("ADVISOR", "Camilla Delt", { advisorProfile: { create: { active: true, bio: "Offentlig bio", pricePerMeetingDkk: 1750 } } });
    const inactive = await mk("ADVISOR", "Nikolaj Inaktiv", { advisorProfile: { create: { active: false, bio: "SECRET-BIO-NIKOLAJ" } } });
    const leadAdv = await mk("ADVISOR", "Lea Ansvarlig", { advisorProfile: { create: { active: true, pricePerMeetingDkk: 1750 } } });
    await prisma.advisorTag.create({ data: { advisorId: leadAdv.id, tagId: await getLeadTagId() } });
    await prisma.availabilityBlock.create({ data: { advisorId: inactive.id, startsAt: soon(5), endsAt: soon(6), reason: "SECRET-REASON-NIKOLAJ" } });
    const cust = (name: string) => mk("CUSTOMER", name, { customerProfile: { create: { companyName: `${name} ApS`, cvr: "1", billingEmail: "b@rem.test" } } });
    const cA = await cust("Rem Kunde A");
    const cB = await cust("Rem Kunde B");
    const cC = await cust("Rem Kunde C (opsagt)");
    const board = (customerId: string, advisorIds: string[], status: "ACTIVE" | "CANCELLED" = "ACTIVE") =>
      prisma.subscription.create({
        data: { customerId, advisorCount: advisorIds.length, frequencyWeeks: 8, monthlyPriceDkk: 1, status, startedAt: new Date(), advisors: { create: advisorIds.map((advisorId) => ({ advisorId })) } },
      });
    const sA = await board(cA.id, [leadAdv.id]);
    const sB = await board(cB.id, [shared.id]);
    const sC = await board(cC.id, [inactive.id], "CANCELLED");
    const meeting = (subscriptionId: string, people: string[], startsAt: Date, status: "BOOKED" | "CANCELLED" | "COMPLETED" = "BOOKED") =>
      prisma.meeting.create({ data: { subscriptionId, startsAt, endsAt: new Date(startsAt.getTime() + 90 * 60_000), status, participants: { create: people.map((userId) => ({ userId })) } } });
    const near = await meeting(sB.id, [cB.id, shared.id], soon(10));
    const cancelled = await meeting(sB.id, [cB.id, shared.id], soon(12), "CANCELLED");
    const far = await meeting(sB.id, [cB.id, shared.id], soon(730));
    const past = await meeting(sB.id, [cB.id, shared.id], soon(-365), "COMPLETED");
    // Offeret i M-1: et ufuldendt lead med telefon og et samtykke med IP og user-agent, knyttet til offerets tilmelding
    const victimEmail = `${uid("offer")}@rem.test`;
    const victimLead = await prisma.lead.create({ data: { email: victimEmail, name: "Rigtig Offer", phone: "+4511111111", step: 2 } });
    const victimConsent = await prisma.marketingConsent.create({
      data: { leadId: victimLead.id, email: victimEmail, phone: "+4511111111", text: "t", textVersion: "m1", source: "onboarding_trin1", ipAddress: "203.0.113.9", userAgent: "VictimUA" },
    });
    const victimToken = uid("onb-offer");
    const victimSession = await prisma.onboardingSession.create({ data: { tokenHash: sha256(victimToken), expiresAt: soon(1), leadId: victimLead.id } });
    const attackerToken = uid("onb-angriber");
    const attackerSession = await prisma.onboardingSession.create({ data: { tokenHash: sha256(attackerToken), expiresAt: soon(1) } });
    return { admin, shared, inactive, leadAdv, cA, cB, cC, sA, sB, sC, near, cancelled, far, past, victimEmail, victimLead, victimConsent, victimToken, victimSession, attackerToken, attackerSession };
  });
}

const as = (u: { id: string; role: "ADMIN" | "ADVISOR" | "CUSTOMER" }) => ({ userId: u.id, role: u.role });

describeDb("Remediation af SECURITY-AUDIT-MFA-RLS.md (adversarialt, som abu_app)", () => {
  let w: World;
  beforeAll(async () => {
    w = await seed();
  }, 30_000);
  beforeEach(() => cookieJar.clear());
  afterAll(async () => {
    if (!w) return;
    const { prisma } = await import("./db");
    const users = [w.admin, w.shared, w.inactive, w.leadAdv, w.cA, w.cB, w.cC].map((u) => u.id);
    await (await ownerDb()).auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { action: { startsWith: "rem." } }] } });
    await asSystem(async () => {
      await prisma.onboardingSession.deleteMany({ where: { OR: [{ id: { in: [w.victimSession.id, w.attackerSession.id] } }, { data: { path: ["contact", "email"], equals: w.victimEmail } }] } });
      await prisma.lead.deleteMany({ where: { email: { endsWith: "@rem.test" } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    });
  });

  // ------------------------------------------------------------------------------------------------- Signeret kontekst
  it("forfalsket kontekst: set_config('app.role','system') fra abu_app giver ingenting – kun appens signerede kontekst tæller", async () => {
    const count = `SELECT (SELECT count(*)::int FROM "User") AS users, (SELECT count(*)::int FROM "Subscription") AS subs, rls.app_role() AS role`;
    // Ingen kontekst, og en angriber sætter selv system (sessions- og transaktionsniveau) eller admin med et rigtigt id
    await rawAsApp(null, async (q) => {
      await q(`SELECT set_config('app.role', 'system', false)`);
      expect((await q(count)).rows[0]).toEqual({ users: 0, subs: 0, role: null });
      await q(`SELECT set_config('app.role', 'system', true), set_config('app.ctx', 'ffffffffffffffff.1.00000000.${"0".repeat(64)}', true)`);
      expect((await q(count)).rows[0]).toEqual({ users: 0, subs: 0, role: null });
      await q(`SELECT set_config('app.role', 'ADMIN', true), set_config('app.user_id', $1, true)`, [w.admin.id]);
      expect((await q(count)).rows[0]).toEqual({ users: 0, subs: 0, role: null });
    });
    // En SQL-injektion i en kundes (signerede) transaktion: genbrug signaturen med en anden rolle/bruger → ingen kontekst
    await rawAsApp(as(w.cA), async (q) => {
      expect((await q(`SELECT rls.app_role() AS r`)).rows[0].r).toBe("CUSTOMER");
      expect((await q(`SELECT count(*)::int AS n FROM "Subscription"`)).rows[0].n).toBe(1);
      await q(`SELECT set_config('app.role', 'system', true)`);
      expect((await q(count)).rows[0]).toEqual({ users: 0, subs: 0, role: null });
      await q(`SELECT set_config('app.role', 'CUSTOMER', true), set_config('app.user_id', $1, true)`, [w.cB.id]);
      expect((await q(count)).rows[0]).toEqual({ users: 0, subs: 0, role: null });
      // Nøglen kan ikke læses, ændres eller udskiftes, og verifikationen kan ikke erstattes
      await expect(q(`SELECT * FROM rls.context_key`)).rejects.toMatchObject({ code: "42501" });
      await expect(q(`INSERT INTO rls.context_key (kid, ipad, opad) VALUES ('0000000000000000', $1, $1)`, [Buffer.alloc(64)])).rejects.toMatchObject({ code: "42501" });
      await expect(q(`DELETE FROM rls.context_key`)).rejects.toMatchObject({ code: "42501" });
      await expect(q(`CREATE OR REPLACE FUNCTION rls.ctx_ok() RETURNS boolean LANGUAGE sql AS 'SELECT true'`)).rejects.toMatchObject({ code: "42501" });
      await expect(q(`SET ROLE abu_owner`)).rejects.toMatchObject({ code: "42501" });
    });
    // Udløbet signatur (> 5 min) eller en ukendt nøgle: ingen kontekst. Appens signerede system: alt.
    const values = ["", "system", "", ""] as const;
    const set = `SELECT set_config('app.user_id', $1, true), set_config('app.role', $2, true), set_config('app.session_id', $3, true), set_config('app.onboarding_token', $4, true), set_config('app.ctx', $5, true)`;
    await rawAsApp(null, async (q) => {
      await q(set, [...values, signContext(values, dbContextKey(), Date.now() - 10 * 60_000)]);
      expect((await q(count)).rows[0].role).toBeNull();
      await q(set, [...values, signContext(values, deriveContextKey("en-anden-hemmelighed-0123456789abcdef"))]);
      expect((await q(count)).rows[0].role).toBeNull();
      await q(set, contextParams({ userId: null, role: "system" }));
      const ok = (await q(count)).rows[0];
      expect(ok.role).toBe("system");
      expect(ok.users).toBeGreaterThan(0);
    });
  });

  it("politikkerne kalder kontekstfunktionerne som InitPlan, og alle SECURITY DEFINER-funktioner har fast search_path", async () => {
    await rawAsApp(null, async (q) => {
      const policies = (await q(`SELECT tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expr FROM pg_policies WHERE schemaname = 'public'`)).rows as { tablename: string; policyname: string; expr: string }[];
      expect(policies.length).toBeGreaterThan(80);
      const unwrapped = policies.filter((p) => /(?<!SELECT )rls\.(app_user_id|app_role|app_session_id|app_onboarding_token|app_has_context|app_is_admin|app_is_system|app_caller_is_system|app_session_user_id)\(\)/.test(p.expr));
      expect(unwrapped.map((p) => `${p.tablename}.${p.policyname}`)).toEqual([]);
      const definers = (await q(`SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'rls'::regnamespace AND p.prosecdef AND NOT coalesce(array_to_string(p.proconfig, ',') LIKE '%search_path=pg_catalog, pg_temp%', false)`)).rows;
      expect(definers).toEqual([]);
    });
  });
});
