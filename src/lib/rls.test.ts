import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { asAnon, asSystem, asUser, describeDb, ownerDb, uid } from "../test/db";
import { pgClientConfig } from "./db-config";
import { DbContextError, type Principal } from "./db-context";
import { sha256 } from "./tokens";

/**
 * RLS fase 1–3: politikkerne pr. tabel, testet som app-rollen abu_app (TEST_DATABASE_URL) – både via appens Prisma-klient
 * med en principal og med rå SQL i samme kontekst (en SQL-injektion får ikke mere end principalen). Testdata oprettes i
 * systemkontekst: to kunder med hver sit board og møde, rådgivere (én inaktiv, uden board), admin- og kompetence-tags,
 * tilmeldinger, notifikationer og systemtabeller.
 */

/** Tabeller i public, der bevidst IKKE har RLS: migrationshistorikken (app-rollerne har slet ingen adgang). */
export const RLS_EXEMPT_TABLES = ["_prisma_migrations"];

const appUrl = process.env.TEST_DATABASE_URL ?? "";

type World = Awaited<ReturnType<typeof seedWorld>>;

async function seedWorld() {
  const { prisma } = await import("./db");
  const { getLeadTagId } = await import("./lead");
  return asSystem(async () => {
    const mk = (role: "ADMIN" | "ADVISOR" | "CUSTOMER", name: string, extra: object = {}) =>
      prisma.user.create({ data: { email: `${uid(role.toLowerCase())}@rls.test`, name, phone: "+4520000000", role, passwordHash: `hash-${name}`, ...extra } });
    const admin = await mk("ADMIN", "RLS Admin");
    const adv = async (name: string, active: boolean) => mk("ADVISOR", name, { advisorProfile: { create: { active, bio: `Bio ${name}` } } });
    const v1 = await adv("RLS Rådgiver Et", true);
    const v2 = await adv("RLS Rådgiver To", true);
    const v3 = await adv("RLS Rådgiver Tre", true);
    const v4 = await adv("RLS Inaktiv", false);
    const cust = (name: string) => mk("CUSTOMER", name, { customerProfile: { create: { companyName: `${name} ApS`, cvr: "1", billingEmail: "b@rls.test" } } });
    const c1 = await cust("RLS Kunde Et");
    const c2 = await cust("RLS Kunde To");
    const competence = await prisma.tag.create({ data: { slug: uid("rls-kompetence"), name: uid("RLS Kompetence") } });
    const internal = await prisma.tag.create({ data: { slug: uid("rls-intern"), name: uid("RLS Intern"), kind: "ADMIN" } });
    const leadTag = await getLeadTagId();
    await prisma.advisorTag.createMany({ data: [{ advisorId: v1.id, tagId: competence.id }, { advisorId: v1.id, tagId: internal.id }, { advisorId: v1.id, tagId: leadTag }] });
    const board = (customerId: string, advisorIds: string[]) =>
      prisma.subscription.create({
        data: { customerId, advisorCount: advisorIds.length, frequencyWeeks: 8, monthlyPriceDkk: 1, status: "ACTIVE", startedAt: new Date(), advisors: { create: advisorIds.map((advisorId, i) => ({ advisorId, isLead: i === 0 })) } },
      });
    const s1 = await board(c1.id, [v1.id, v2.id]);
    const s2 = await board(c2.id, [v3.id]);
    const meeting = (subscriptionId: string, people: string[], startsAt: Date) =>
      prisma.meeting.create({
        data: {
          subscriptionId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 90 * 60_000),
          participants: { create: people.map((userId) => ({ userId })) },
          transcript: { create: { text: `Fortroligt referat ${subscriptionId}` } },
          recordings: { create: [{ source: "UPLOAD", status: "DONE", uploadedById: people[1] }] },
        },
      });
    const start = new Date("2031-03-03T09:00:00Z");
    const m1 = await meeting(s1.id, [c1.id, v1.id, v2.id], start);
    const m2 = await meeting(s2.id, [c2.id, v3.id], start);
    await prisma.availabilityRule.createMany({ data: [{ advisorId: v1.id, weekday: 1, startMinute: 480, endMinute: 960 }, { advisorId: v3.id, weekday: 1, startMinute: 480, endMinute: 960 }] });
    await prisma.availabilityBlock.create({ data: { advisorId: v3.id, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000), reason: "Privat aftale" } });
    const q = await prisma.onboardingQuestion.create({ data: { text: uid("RLS spørgsmål"), active: true, answers: { create: [{ text: "Ja", weights: { create: [{ tagId: competence.id, weight: 3 }] } }] } } });
    const qOff = await prisma.onboardingQuestion.create({ data: { text: uid("RLS kladde"), active: false } });
    const onb = async (token: string) => {
      const lead = await prisma.lead.create({ data: { email: `${uid("lead")}@rls.test`, name: "Lead", phone: "+4530000000" } });
      await prisma.marketingConsent.create({ data: { leadId: lead.id, email: lead.email, text: "t", textVersion: "m1", source: "test" } });
      const session = await prisma.onboardingSession.create({ data: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000), leadId: lead.id } });
      return { lead, session, token };
    };
    const o1 = await onb(uid("onb-et"));
    const o2 = await onb(uid("onb-to"));
    const log = (u: { id: string; email: string }) =>
      prisma.notificationLog.create({ data: { id: uid("nl"), templateKey: "t", trigger: "test", channel: "EMAIL", recipientUserId: u.id, recipientAddress: u.email, entityType: "test", entityId: uid("e"), scheduledFor: new Date() } });
    const n1 = await log(c1);
    const n2 = await log(c2);
    const sessionToken = uid("sess");
    const session = await prisma.session.create({ data: { id: sha256(sessionToken), userId: c1.id, expiresAt: new Date(Date.now() + 3_600_000), mfaPending: true } });
    await prisma.trustedDevice.create({ data: { userId: c1.id, tokenHash: uid("td"), label: "Test", expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.mfaRecoveryCode.create({ data: { userId: c1.id, codeHash: uid("rc") } });
    await prisma.passwordToken.create({ data: { userId: c1.id, tokenHash: uid("pt"), purpose: "RESET", expiresAt: new Date(Date.now() + 3_600_000) } });
    const job = await prisma.job.create({ data: { type: "rls_test_noop", payload: {}, status: "DONE" } });
    const webhook = await prisma.webhookEvent.create({ data: { provider: "test", externalId: uid("wh"), payload: { kunde: c1.email } } });
    const rate = await prisma.rateLimit.create({ data: { key: uid("rl"), count: 1, resetAt: new Date(Date.now() + 60_000) } });
    const cvr = await prisma.cvrLookupCache.create({ data: { cvr: uid("cvr"), result: {}, expiresAt: new Date(Date.now() + 60_000) } });
    const idem = await prisma.idempotencyKey.create({ data: { id: uid("idem"), userId: c1.id, scope: "test", expiresAt: new Date(Date.now() + 60_000) } });
    await prisma.appSetting.createMany({ data: [{ key: `rls.test.${uid()}`, value: "1" }, { key: `alert:rls_${uid()}`, value: "{}" }] });
    await prisma.auditLog.createMany({ data: [{ userId: c2.id, action: "rls.test", entity: "Test", entityId: c2.id }] });
    return { admin, v1, v2, v3, v4, c1, c2, s1, s2, m1, m2, competence, internal, leadTag, q, qOff, o1, o2, n1, n2, session, sessionToken, job, webhook, rate, cvr, idem };
  });
}

const who = (u: { id: string; role: Principal["role"] }) => ({ id: u.id, role: u.role as Exclude<Principal["role"], "anon" | "system"> });

/** Rå SQL som abu_app i en given kontekst (som en SQL-injektion i den kontekst). null = ingen kontekst. */
async function rawAs<T>(ctx: Principal | null, fn: (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>): Promise<T> {
  const client = new pg.Client(pgClientConfig(appUrl));
  await client.connect();
  try {
    await client.query("BEGIN");
    if (ctx) {
      await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.role', $2, true), set_config('app.session_id', $3, true), set_config('app.onboarding_token', $4, true)", [
        ctx.userId ?? "",
        ctx.role,
        ctx.sessionId ?? "",
        ctx.onboardingToken ?? "",
      ]);
    }
    let n = 0;
    return await fn(async (sql, params) => {
      // Fejl skal kunne forventes uden at afbryde resten af transaktionen
      const sp = `s${n++}`;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        const r = await client.query(sql, params);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        return r;
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        throw e;
      }
    });
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describeDb("Row-Level Security: alle tabeller og politikker (abu_app)", () => {
  let w: World;
  beforeAll(async () => {
    w = await seedWorld();
  }, 30_000);
  afterAll(async () => {
    const { prisma } = await import("./db");
    if (!w) return;
    const users = [w.admin, w.v1, w.v2, w.v3, w.v4, w.c1, w.c2].map((u) => u.id);
    await (await ownerDb()).auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { action: "rls.test" }] } });
    await asSystem(async () => {
      await prisma.onboardingSession.deleteMany({ where: { id: { in: [w.o1.session.id, w.o2.session.id] } } });
      await prisma.lead.deleteMany({ where: { id: { in: [w.o1.lead.id, w.o2.lead.id] } } });
      await prisma.onboardingQuestion.deleteMany({ where: { id: { in: [w.q.id, w.qOff.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.tag.deleteMany({ where: { id: { in: [w.competence.id, w.internal.id] } } });
      await prisma.job.deleteMany({ where: { id: w.job.id } });
      await prisma.webhookEvent.deleteMany({ where: { id: w.webhook.id } });
      await prisma.rateLimit.deleteMany({ where: { key: w.rate.key } });
      await prisma.cvrLookupCache.deleteMany({ where: { cvr: w.cvr.cvr } });
      await prisma.appSetting.deleteMany({ where: { OR: [{ key: { startsWith: "rls.test." } }, { key: { startsWith: "alert:rls_" } }] } });
    });
  });

  it("alle tabeller i public har ENABLE + FORCE ROW LEVEL SECURITY og mindst én politik (undtagen allow-listen)", async () => {
    const rows = await rawAs(null, async (q) =>
      (
        await q(`SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                        (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
                   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname`)
      ).rows as { relname: string; rls: boolean; force: boolean; policies: number }[],
    );
    expect(rows.length).toBeGreaterThanOrEqual(34);
    const missing = rows.filter((r) => !RLS_EXEMPT_TABLES.includes(r.relname) && (!r.rls || !r.force || r.policies === 0)).map((r) => r.relname);
    expect(missing).toEqual([]);
    // Undtagelsen er lukket på anden vis: app-rollen har ingen rettigheder til migrationshistorikken
    const priv = await rawAs(null, async (q) => (await q(`SELECT has_table_privilege(current_user, '"_prisma_migrations"', 'SELECT') AS s`)).rows[0].s);
    expect(priv).toBe(false);
  });

  it("uden kontekst afvises alt: ingen rækker i nogen tabel, ingen skrivninger, og klienten kaster DbContextError", async () => {
    const tables = await rawAs(null, async (q) => (await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`)).rows.map((r) => r.tablename as string));
    const counts = await rawAs(null, async (q) => {
      const out: [string, number][] = [];
      for (const t of tables) out.push([t, (await q(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n]);
      return out;
    });
    expect(counts.filter(([, n]) => n > 0)).toEqual([]);
    await rawAs(null, async (q) => {
      await expect(q(`INSERT INTO "AuditLog" (id, action, entity, "entityId") VALUES ('${uid("x")}', 'x', 'x', 'x')`)).rejects.toMatchObject({ code: "42501" });
      expect((await q(`UPDATE "Subscription" SET "monthlyPriceDkk" = 0`)).rowCount).toBe(0);
      expect((await q(`DELETE FROM "Meeting"`)).rowCount).toBe(0);
      // Hjælpefunktionerne giver heller intet uden kontekst
      expect((await q(`SELECT * FROM rls.user_directory($1)`, [[w.v1.id, w.c1.id]])).rows).toEqual([]);
      await expect(q(`SELECT rls.rate_limit_hit('x', now()::timestamp, now()::timestamp)`)).rejects.toMatchObject({ code: "42501" });
    });
    // En ukendt rolle tæller som ingen kontekst
    await rawAs({ userId: w.c1.id, role: "superuser" as Principal["role"] }, async (q) => {
      expect((await q(`SELECT count(*)::int AS n FROM "Subscription"`)).rows[0].n).toBe(0);
    });
    const { prisma } = await import("./db");
    await expect(prisma.meeting.findMany()).rejects.toBeInstanceOf(DbContextError);
    await expect(prisma.$queryRaw`SELECT 1`).rejects.toBeInstanceOf(DbContextError);
  });

  it("kunde: kun egne abonnementer, møder, referater, optagelser og notifikationer – også med rå SQL i kundens kontekst", async () => {
    const { prisma } = await import("./db");
    const c1 = who(w.c1);
    await asUser(c1, async () => {
      expect(ids(await prisma.subscription.findMany({ where: { id: { in: [w.s1.id, w.s2.id] } } }))).toEqual([w.s1.id]);
      expect(ids(await prisma.meeting.findMany({ where: { id: { in: [w.m1.id, w.m2.id] } } }))).toEqual([w.m1.id]);
      expect(await prisma.transcript.findUnique({ where: { meetingId: w.m2.id } })).toBeNull();
      expect(await prisma.transcript.findUnique({ where: { meetingId: w.m1.id } })).not.toBeNull();
      expect(await prisma.recording.count({ where: { meetingId: w.m2.id } })).toBe(0);
      expect(await prisma.meetingParticipant.count({ where: { meetingId: w.m2.id } })).toBe(0);
      expect(await prisma.subscriptionAdvisor.count({ where: { subscriptionId: w.s2.id } })).toBe(0);
      expect(ids(await prisma.notificationLog.findMany({ where: { id: { in: [w.n1.id, w.n2.id] } } }))).toEqual([w.n1.id]);
      expect(await prisma.customerProfile.findUnique({ where: { userId: w.c2.id } })).toBeNull();
      // Egen konto ja, andres nej – heller ikke boardets rådgivere (kun navn via kataloget)
      expect(await prisma.user.findUnique({ where: { id: w.c1.id } })).not.toBeNull();
      expect(await prisma.user.findUnique({ where: { id: w.c2.id } })).toBeNull();
      expect(await prisma.user.findUnique({ where: { id: w.v1.id } })).toBeNull();
      const { userDirectory } = await import("./user-directory");
      const dir = await userDirectory([w.v1.id, w.v2.id, w.c2.id, w.v4.id]);
      expect([...dir.keys()].sort()).toEqual([w.v1.id, w.v2.id].sort());
      expect(Object.keys(dir.get(w.v1.id)!).sort()).toEqual(["id", "name", "role"]);
      // Systemtabeller og audit-loggen er usynlige
      expect(await prisma.auditLog.count()).toBe(0);
      expect(await prisma.job.count()).toBe(0);
      expect(await prisma.mfaRecoveryCode.count({ where: { userId: w.c2.id } })).toBe(0);
    });
    await rawAs({ userId: w.c1.id, role: "CUSTOMER" }, async (q) => {
      const t = (await q(`SELECT "meetingId" FROM "Transcript"`)).rows.map((r) => r.meetingId);
      expect(t).toContain(w.m1.id);
      expect(t).not.toContain(w.m2.id);
      expect((await q(`SELECT id FROM "Meeting" WHERE id = $1`, [w.m2.id])).rows).toEqual([]);
      expect((await q(`SELECT text FROM "Transcript" WHERE "meetingId" = $1`, [w.m2.id])).rows).toEqual([]);
      expect((await q(`SELECT id FROM "User" WHERE id <> $1`, [w.c1.id])).rows).toEqual([]);
      expect((await q(`SELECT "passwordHash" FROM "User" WHERE id = $1`, [w.c2.id])).rows).toEqual([]);
      // Skrivninger i en anden kundes data rammer ingen rækker eller afvises
      expect((await q(`UPDATE "Subscription" SET status = 'CANCELLED' WHERE id = $1`, [w.s2.id])).rowCount).toBe(0);
      expect((await q(`UPDATE "Meeting" SET status = 'CANCELLED' WHERE id = $1`, [w.m2.id])).rowCount).toBe(0);
      expect((await q(`DELETE FROM "Subscription" WHERE id = $1`, [w.s1.id])).rowCount).toBe(0); // kun PENDING må slettes
      await expect(q(`INSERT INTO "Meeting" (id, "subscriptionId", "startsAt", "endsAt") VALUES ($1, $2, now(), now())`, [uid("m"), w.s2.id])).rejects.toMatchObject({ code: "42501" });
      await expect(q(`INSERT INTO "MeetingParticipant" ("meetingId", "userId") VALUES ($1, $2)`, [w.m2.id, w.c1.id])).rejects.toMatchObject({ code: "42501" });
      await expect(q(`INSERT INTO "Subscription" (id, "customerId", "advisorCount", "frequencyWeeks", "monthlyPriceDkk") VALUES ($1, $2, 1, 8, 1)`, [uid("s"), w.c2.id])).rejects.toMatchObject({ code: "42501" });
      // Audit: egne handlinger kan logges (append-only), andres kan ikke forfalskes, og loggen kan ikke læses
      expect((await q(`INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId") VALUES ($1, $2, 'rls.test', 'T', 'x')`, [uid("a"), w.c1.id])).rowCount).toBe(1);
      await expect(q(`INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId") VALUES ($1, $2, 'rls.test', 'T', 'x')`, [uid("a"), w.c2.id])).rejects.toMatchObject({ code: "42501" });
      expect((await q(`SELECT count(*)::int AS n FROM "AuditLog"`)).rows[0].n).toBe(0);
      // Kolonneværnet: egne felter ja (navn), beskyttede nej (spærring, MFA, sidste login); identitet aldrig (kolonnerettighed)
      expect((await q(`UPDATE "User" SET name = 'Nyt Navn' WHERE id = $1`, [w.c1.id])).rowCount).toBe(1);
      await expect(q(`UPDATE "User" SET "lockedUntil" = NULL, "failedLoginCount" = 0 WHERE id = $1`, [w.c1.id])).resolves.toMatchObject({ rowCount: 1 }); // uændret = tilladt
      await expect(q(`UPDATE "User" SET "failedLoginCount" = 99 WHERE id = $1`, [w.c1.id])).rejects.toMatchObject({ code: "42501" });
      await expect(q(`UPDATE "User" SET "mfaEnabledAt" = now() WHERE id = $1`, [w.c1.id])).rejects.toMatchObject({ code: "42501" });
      await expect(q(`UPDATE "User" SET "lastLoginAt" = now() WHERE id = $1`, [w.c1.id])).rejects.toMatchObject({ code: "42501" });
      await expect(q(`UPDATE "User" SET role = 'ADMIN' WHERE id = $1`, [w.c1.id])).rejects.toMatchObject({ code: "42501" });
      await expect(q(`UPDATE "User" SET email = 'x@rls.test' WHERE id = $1`, [w.c1.id])).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("kunde: ledige tider kun for egne rådgivere (rls.advisor_busy) og deres regler/fravær – ikke andres kalender", async () => {
    const { prisma } = await import("./db");
    await asUser(who(w.c1), async () => {
      const { loadAvailability } = await import("./booking");
      const [a] = await loadAvailability(prisma, [w.v1.id], new Date("2031-03-01T00:00:00Z"), new Date("2031-03-10T00:00:00Z"));
      expect(a.rules).toHaveLength(1);
      expect(a.meetings).toEqual([{ startsAt: w.m1.startsAt, endsAt: w.m1.endsAt }]);
      await expect(loadAvailability(prisma, [w.v3.id], new Date("2031-03-01T00:00:00Z"), new Date("2031-03-10T00:00:00Z"))).rejects.toThrow(/kalender/);
      expect(await prisma.availabilityRule.count({ where: { advisorId: w.v3.id } })).toBe(0);
      expect(await prisma.availabilityBlock.count({ where: { advisorId: w.v3.id } })).toBe(0);
    });
    // Kunde 2 ser rådgiver 3's optagne tid (eget møde), men ikke andet om mødet
    await rawAs({ userId: w.c2.id, role: "CUSTOMER" }, async (q) => {
      const busy = (await q(`SELECT * FROM rls.advisor_busy($1, '2031-03-01', '2031-03-10', NULL)`, [[w.v3.id]])).rows;
      expect(busy).toHaveLength(1);
      expect(Object.keys(busy[0]).sort()).toEqual(["advisor_id", "ends_at", "starts_at", "status"]);
    });
  });

  it("rådgiver: kun møder, man deltager i, og boards, man sidder i; kundens virksomhed men ikke dens konto", async () => {
    const { prisma } = await import("./db");
    await asUser(who(w.v1), async () => {
      expect(ids(await prisma.meeting.findMany({ where: { id: { in: [w.m1.id, w.m2.id] } } }))).toEqual([w.m1.id]);
      expect(ids(await prisma.subscription.findMany({ where: { id: { in: [w.s1.id, w.s2.id] } } }))).toEqual([w.s1.id]);
      expect(await prisma.transcript.findUnique({ where: { meetingId: w.m2.id } })).toBeNull();
      expect((await prisma.customerProfile.findUnique({ where: { userId: w.c1.id } }))?.companyName).toBe("RLS Kunde Et ApS");
      expect(await prisma.customerProfile.findUnique({ where: { userId: w.c2.id } })).toBeNull();
      expect(await prisma.user.findUnique({ where: { id: w.c1.id } })).toBeNull();
      // Boardets medlemmer og den ansvarlige er synlige for medrådgiveren
      expect((await prisma.subscriptionAdvisor.findMany({ where: { subscriptionId: w.s1.id } })).map((a) => a.advisorId).sort()).toEqual([w.v1.id, w.v2.id].sort());
      // Admin-tags er usynlige, også rådgiverens egne
      expect(await prisma.tag.findUnique({ where: { id: w.internal.id } })).toBeNull();
      expect((await prisma.advisorTag.findMany({ where: { advisorId: w.v1.id } })).map((t) => t.tagId)).toEqual([w.competence.id]);
    });
    await rawAs({ userId: w.v1.id, role: "ADVISOR" }, async (q) => {
      // Kun admin/kunden ændrer møder; rådgiveren kan ikke
      expect((await q(`UPDATE "Meeting" SET status = 'CANCELLED' WHERE id = $1`, [w.m1.id])).rowCount).toBe(0);
      // Egen tilgængelighed ja, andres nej
      expect((await q(`INSERT INTO "AvailabilityRule" (id, "advisorId", weekday, "startMinute", "endMinute") VALUES ($1, $2, 2, 480, 600)`, [uid("r"), w.v1.id])).rowCount).toBe(1);
      await expect(q(`INSERT INTO "AvailabilityRule" (id, "advisorId", weekday, "startMinute", "endMinute") VALUES ($1, $2, 2, 480, 600)`, [uid("r"), w.v3.id])).rejects.toMatchObject({ code: "42501" });
      expect((await q(`SELECT count(*)::int AS n FROM "AvailabilityRule" WHERE "advisorId" = $1`, [w.v3.id])).rows[0].n).toBe(0);
      // Pris og aktivering er admins; titel og bio sine egne
      expect((await q(`UPDATE "AdvisorProfile" SET bio = 'Ny' WHERE "userId" = $1`, [w.v1.id])).rowCount).toBe(1);
      await expect(q(`UPDATE "AdvisorProfile" SET "pricePerMeetingDkk" = 1 WHERE "userId" = $1`, [w.v1.id])).rejects.toMatchObject({ code: "42501" });
      expect((await q(`UPDATE "AdvisorProfile" SET bio = 'Hack' WHERE "userId" = $1`, [w.v3.id])).rowCount).toBe(0);
      // Optagelser kun på egne møder
      await expect(q(`INSERT INTO "Recording" (id, "meetingId", source, "uploadedById") VALUES ($1, $2, 'UPLOAD', $3)`, [uid("rec"), w.m2.id, w.v1.id])).rejects.toMatchObject({ code: "42501" });
      expect((await q(`SELECT count(*)::int AS n FROM "Tag" WHERE kind = 'ADMIN'`)).rows[0].n).toBe(0);
    });
    // Rådgiver 3 ser ikke møde 1 og kan ikke slå boardets rådgiveres kalender op
    await rawAs({ userId: w.v3.id, role: "ADVISOR" }, async (q) => {
      expect((await q(`SELECT id FROM "Meeting" WHERE id = $1`, [w.m1.id])).rows).toEqual([]);
      await expect(q(`SELECT * FROM rls.advisor_busy($1, '2031-01-01', '2031-12-31', NULL)`, [[w.v1.id]])).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("anon (før login): kun aktive rådgiverprofiler, kompetence-tags, aktive spørgsmål og tekster – og egen tilmelding via cookiens hash", async () => {
    const { prisma } = await import("./db");
    await asAnon(async () => {
      const profiles = (await prisma.advisorProfile.findMany({ where: { userId: { in: [w.v1.id, w.v4.id] } } })).map((p) => p.userId);
      expect(profiles).toEqual([w.v1.id]);
      expect(await prisma.tag.findUnique({ where: { id: w.competence.id } })).not.toBeNull();
      expect(await prisma.tag.findUnique({ where: { id: w.internal.id } })).toBeNull();
      expect(await prisma.tag.findUnique({ where: { id: w.leadTag } })).toBeNull();
      expect((await prisma.advisorTag.findMany({ where: { advisorId: w.v1.id } })).map((t) => t.tagId)).toEqual([w.competence.id]);
      // leadEligible kan stadig beregnes (kun booleanen)
      const { leadEligibleIds } = await import("./lead");
      expect([...(await leadEligibleIds([w.v1.id, w.v2.id, w.v4.id]))]).toEqual([w.v1.id]);
      expect(ids(await prisma.onboardingQuestion.findMany({ where: { id: { in: [w.q.id, w.qOff.id] } } }))).toEqual([w.q.id]);
      expect(await prisma.answerTagWeight.count({ where: { tagId: w.competence.id } })).toBe(1);
      expect(await prisma.user.count()).toBe(0);
      expect(await prisma.subscription.count()).toBe(0);
      expect(await prisma.meeting.count()).toBe(0);
      expect(await prisma.customerProfile.count()).toBe(0);
      expect(await prisma.lead.count()).toBe(0);
      expect(await prisma.onboardingSession.count()).toBe(0);
      expect(await prisma.appSetting.count({ where: { key: { startsWith: "rls.test." } } })).toBe(1);
      expect(await prisma.appSetting.count({ where: { key: { startsWith: "alert:" } } })).toBe(0);
      expect(await prisma.notificationTemplate.count()).toBe(0);
      // Navne kun på aktive rådgivere
      const { userDirectory } = await import("./user-directory");
      expect([...(await userDirectory([w.v1.id, w.v4.id, w.c1.id])).keys()]).toEqual([w.v1.id]);
    });
    // Med onboarding-cookien: egen tilmelding, dens lead og samtykke – ikke andres
    await asAnon(
      async () => {
        expect(ids(await prisma.onboardingSession.findMany())).toEqual([w.o1.session.id]);
        expect(ids(await prisma.lead.findMany())).toEqual([w.o1.lead.id]);
        expect((await prisma.marketingConsent.findMany()).map((c) => c.leadId)).toEqual([w.o1.lead.id]);
        expect((await prisma.lead.updateMany({ where: { id: w.o2.lead.id }, data: { step: 6 } })).count).toBe(0);
        expect((await prisma.lead.updateMany({ where: { id: w.o1.lead.id }, data: { step: 2 } })).count).toBe(1);
      },
      { onboardingToken: sha256(w.o1.token) },
    );
    await rawAs({ userId: null, role: "anon", onboardingToken: sha256(w.o1.token) }, async (q) => {
      await expect(q(`INSERT INTO "MarketingConsent" (id, "leadId", email, text, "textVersion", source) VALUES ($1, $2, 'x@rls.test', 't', 'v', 's')`, [uid("mc"), w.o2.lead.id])).rejects.toMatchObject({ code: "42501" });
      expect((await q(`INSERT INTO "MarketingConsent" (id, "leadId", email, text, "textVersion", source) VALUES ($1, $2, 'x@rls.test', 't', 'v', 's')`, [uid("mc"), w.o1.lead.id])).rowCount).toBe(1);
      await expect(q(`INSERT INTO "Lead" (id, email, name) VALUES ($1, $2, 'x')`, [uid("l"), `${uid()}@rls.test`])).rejects.toMatchObject({ code: "42501" });
      // Rate limit virker før login via funktionen, men tabellen er lukket
      expect((await q(`SELECT hits FROM rls.rate_limit_hit($1, now()::timestamp + interval '1 minute', now()::timestamp)`, [uid("anon-rl")])).rows[0].hits).toBe(1);
      expect((await q(`SELECT count(*)::int AS n FROM "RateLimit"`)).rows[0].n).toBe(0);
    });
  });

  it("MFA-ventende session (anon + sessionens hash): kun egen session og egen bruger", async () => {
    const pending: Principal = { userId: null, role: "anon", sessionId: w.session.id };
    await rawAs(pending, async (q) => {
      expect((await q(`SELECT id FROM "Session"`)).rows.map((r) => r.id)).toEqual([w.session.id]);
      expect((await q(`SELECT id FROM "User"`)).rows.map((r) => r.id)).toEqual([w.c1.id]);
      expect((await q(`SELECT count(*)::int AS n FROM "Subscription"`)).rows[0].n).toBe(0);
      expect((await q(`SELECT count(*)::int AS n FROM "TrustedDevice"`)).rows[0].n).toBe(0);
      // Kan ikke selv ændre sin bruger eller oprette sessioner (det sker auth-internt i systemkontekst)
      expect((await q(`UPDATE "User" SET name = 'x' WHERE id = $1`, [w.c1.id])).rowCount).toBe(0);
      await expect(q(`INSERT INTO "Session" (id, "userId", "expiresAt") VALUES ($1, $2, now())`, [uid("s"), w.c1.id])).rejects.toMatchObject({ code: "42501" });
    });
    // getSessionContext slår sessionen op med netop denne principal (cookiens hash)
    const { prisma } = await import("./db");
    const found = await asAnon(() => prisma.session.findUnique({ where: { id: sha256(w.sessionToken) }, include: { user: true } }), { sessionId: sha256(w.sessionToken) });
    expect(found?.user.id).toBe(w.c1.id);
    expect(await asAnon(() => prisma.session.findUnique({ where: { id: sha256(w.sessionToken) } }))).toBeNull();
  });

  it("admin: alt i appen (også admin-tags og andres konti), men ikke systemtabellerne eller gendannelseskoder", async () => {
    const { prisma } = await import("./db");
    await asUser(who(w.admin), async () => {
      expect(await prisma.subscription.count({ where: { id: { in: [w.s1.id, w.s2.id] } } })).toBe(2);
      expect(await prisma.transcript.count({ where: { meetingId: { in: [w.m1.id, w.m2.id] } } })).toBe(2);
      expect(await prisma.user.count({ where: { id: { in: [w.c1.id, w.c2.id, w.v4.id] } } })).toBe(3);
      expect(await prisma.tag.findUnique({ where: { id: w.internal.id } })).not.toBeNull();
      expect(await prisma.advisorTag.count({ where: { advisorId: w.v1.id } })).toBe(3);
      expect(await prisma.lead.count({ where: { id: { in: [w.o1.lead.id, w.o2.lead.id] } } })).toBe(2);
      expect(await prisma.auditLog.count({ where: { action: "rls.test" } })).toBeGreaterThanOrEqual(1);
      expect(await prisma.job.count({ where: { id: w.job.id } })).toBe(1); // forsiden viser antal
      expect(await prisma.appSetting.count({ where: { key: { startsWith: "alert:rls_" } } })).toBe(1);
      // Systemtabeller og gendannelseskoder: nej
      expect(await prisma.webhookEvent.count()).toBe(0);
      expect(await prisma.rateLimit.count()).toBe(0);
      expect(await prisma.cvrLookupCache.count()).toBe(0);
      expect(await prisma.idempotencyKey.count()).toBe(0);
      expect(await prisma.mfaRecoveryCode.count()).toBe(0);
    });
    await rawAs({ userId: w.admin.id, role: "ADMIN" }, async (q) => {
      await expect(q(`INSERT INTO "Job" (id, type, payload) VALUES ($1, 'x', '{}')`, [uid("j")])).rejects.toMatchObject({ code: "42501" });
      // Audit-loggen er append-only også for admin; en admins identitet kan heller ikke skiftes
      await expect(q(`UPDATE "AuditLog" SET detail = 'x'`)).rejects.toMatchObject({ code: "42501" });
      await expect(q(`UPDATE "User" SET role = 'CUSTOMER' WHERE id = $1`, [w.admin.id])).rejects.toMatchObject({ code: "42501" });
    });
    // Admin uden bruger-id er ikke admin
    await rawAs({ userId: null, role: "ADMIN" }, async (q) => expect((await q(`SELECT count(*)::int AS n FROM "Subscription"`)).rows[0].n).toBe(0));
  });

  it("system: alle tabeller (jobs, webhooks, cache, rate limits) og jobkøens claim-forespørgsel", async () => {
    const { prisma } = await import("./db");
    await asSystem(async () => {
      expect(await prisma.webhookEvent.count({ where: { id: w.webhook.id } })).toBe(1);
      expect(await prisma.rateLimit.count({ where: { key: w.rate.key } })).toBe(1);
      expect(await prisma.cvrLookupCache.count({ where: { cvr: w.cvr.cvr } })).toBe(1);
      expect(await prisma.idempotencyKey.count({ where: { id: w.idem.id } })).toBe(1);
      expect(await prisma.mfaRecoveryCode.count({ where: { userId: w.c1.id } })).toBe(1);
      expect(await prisma.passwordToken.count({ where: { userId: w.c1.id } })).toBe(1);
      // Samme UPDATE … FOR UPDATE SKIP LOCKED som jobs.ts (rå SQL er også underlagt RLS – i systemkontekst ser den alt)
      const pending = await prisma.job.create({ data: { type: "rls_test_noop", payload: {}, runAt: new Date(Date.now() - 1000) } });
      const claimed = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "Job" SET status = 'RUNNING', "lockedAt" = now(), attempts = attempts + 1
        WHERE id = (SELECT id FROM "Job" WHERE id = ${pending.id} AND status = 'PENDING' FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id`;
      expect(claimed).toEqual([{ id: pending.id }]);
      await prisma.job.delete({ where: { id: pending.id } });
    });
    // Samme claim i en kundes kontekst rammer intet
    await rawAs({ userId: w.c1.id, role: "CUSTOMER" }, async (q) => {
      expect((await q(`UPDATE "Job" SET status = 'RUNNING' WHERE id = $1`, [w.job.id])).rowCount).toBe(0);
      expect((await q(`UPDATE "NotificationLog" SET "claimedAt" = now() WHERE id = $1`, [w.n1.id])).rowCount).toBe(0);
    });
  });

  it("jobprocessoren kører i systemkontekst uden rettighedsfejl (også uden en request)", async () => {
    const { processJobs } = await import("./jobs");
    await expect(processJobs(1)).resolves.toBeGreaterThanOrEqual(0);
  });
});
