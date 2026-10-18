import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb, uid } from "../test/db";
import { pgClientConfig } from "./db-config";
import { assertDbRuntimeRole, dbRoleProblems, readDbRoleFacts } from "./db-guard";
import { EnvConfigError } from "./env";

/**
 * RLS fase 0: testene kører som app-rollen abu_app (TEST_DATABASE_URL; migrationer kører som abu_owner, se CI og README).
 * Beviser at rollen kun har DML: ingen DDL, ingen TRUNCATE, ingen systemkataloger med adgangskoder, ingen ejerrolle.
 */
const appUrl = process.env.TEST_DATABASE_URL ?? "";
const ownerUrl = process.env.TEST_DATABASE_URL_OWNER ?? "";

/** SQLSTATE for en sætning, der skal fejle (null = den lykkedes). */
async function sqlState(client: pg.Client, sql: string): Promise<string | null> {
  await client.query("SAVEPOINT p");
  try {
    await client.query(sql);
    await client.query("RELEASE SAVEPOINT p");
    return null;
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT p");
    return (e as { code?: string }).code ?? "?";
  }
}

describeDb("databaserollen abu_app: kun DML (RLS fase 0)", () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client(pgClientConfig(appUrl));
    await client.connect();
    await client.query("BEGIN");
  });
  afterAll(async () => {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  });

  it("testene kører som en rolle uden superbruger, BYPASSRLS, ejerskab eller DDL-ret – og opstartstjekket accepterer den", async () => {
    const facts = await readDbRoleFacts(appUrl);
    expect(facts).toMatchObject({ superuser: false, bypassRls: false, createRole: false, createDb: false, ownedObjects: 0, ownsUserTable: false, ownsDatabase: false, schemaCreate: false });
    expect(dbRoleProblems(facts)).toEqual([]);
    await expect(assertDbRuntimeRole(appUrl, "production", () => {})).resolves.toMatchObject({ user: facts.user });
  });

  it("ingen DDL: CREATE/ALTER/DROP/TRUNCATE, indeks, funktioner, schemaer og rettigheder afvises (42501)", async () => {
    const denied = [
      `CREATE TABLE public.abu_hack (id int)`,
      `CREATE TABLE abu_hack2 (id int)`,
      `ALTER TABLE "User" ADD COLUMN hack text`,
      `ALTER TABLE "User" DISABLE ROW LEVEL SECURITY`,
      `DROP TABLE "RateLimit"`,
      `TRUNCATE "RateLimit"`,
      `TRUNCATE "AuditLog"`,
      `CREATE INDEX abu_hack_idx ON "User" (name)`,
      `CREATE FUNCTION public.abu_hack() RETURNS int LANGUAGE sql AS 'select 1'`,
      `CREATE SCHEMA abu_hack`,
      `CREATE TEMP TABLE abu_tmp (id int)`,
      `ALTER TYPE "Role" ADD VALUE 'HACKER'`,
      `SET ROLE abu_owner`,
      `ALTER ROLE CURRENT_USER BYPASSRLS`,
      `CREATE ROLE abu_hacker`,
    ];
    for (const sql of denied) expect.soft(await sqlState(client, sql), sql).toBe("42501");
    // GRANT uden grant option er kun en advarsel i Postgres – men giver ingen rettighed
    await client.query(`GRANT TRUNCATE ON "RateLimit" TO CURRENT_USER`);
    expect((await client.query(`SELECT has_table_privilege(current_user, '"RateLimit"', 'TRUNCATE') AS t`)).rows[0].t).toBe(false);
  });

  it("kan ikke læse pg_authid (adgangskode-hashes) eller migrationshistorikken", async () => {
    expect(await sqlState(client, "SELECT rolpassword FROM pg_authid")).toBe("42501");
    expect(await sqlState(client, `SELECT * FROM "_prisma_migrations"`)).toBe("42501");
    expect(await sqlState(client, `UPDATE "_prisma_migrations" SET finished_at = now()`)).toBe("42501");
  });

  it("almindelig CRUD virker (via appens Prisma-klient)", async () => {
    const { prisma } = await import("./db");
    const key = uid("rls-crud");
    await prisma.rateLimit.create({ data: { key, count: 1, resetAt: new Date(Date.now() + 60_000) } });
    expect((await prisma.rateLimit.findUnique({ where: { key } }))?.count).toBe(1);
    await prisma.rateLimit.update({ where: { key }, data: { count: 2 } });
    expect((await prisma.rateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(2);
    await prisma.rateLimit.delete({ where: { key } });
    expect(await prisma.rateLimit.findUnique({ where: { key } })).toBeNull();
  });

  it("AuditLog er append-only for appen: læse og tilføje, aldrig ændre eller slette", async () => {
    expect(await sqlState(client, `INSERT INTO "AuditLog" (id, action, entity, "entityId") VALUES ('${uid("al")}', 'test.rls', 'Test', 'x')`)).toBeNull();
    expect(await sqlState(client, `SELECT count(*) FROM "AuditLog"`)).toBeNull();
    expect(await sqlState(client, `UPDATE "AuditLog" SET detail = 'ændret' WHERE action = 'test.rls'`)).toBe("42501");
    expect(await sqlState(client, `DELETE FROM "AuditLog" WHERE action = 'test.rls'`)).toBe("42501");
  });

  it("timeouts sidder på rollen (15 s / 10 s / 30 s), og SET LOCAL kan give et enkelt job en anden grænse", async () => {
    const { rows } = await client.query<{ cfg: string[] | null }>("SELECT rolconfig AS cfg FROM pg_roles WHERE rolname = current_user");
    expect(rows[0].cfg).toEqual(expect.arrayContaining(["statement_timeout=15s", "lock_timeout=10s", "idle_in_transaction_session_timeout=30s"]));
    expect((await client.query("SHOW statement_timeout")).rows[0].statement_timeout).toBe("15s");
    await client.query("SAVEPOINT t");
    await client.query("SET LOCAL statement_timeout = '100ms'");
    await expect(client.query("SELECT pg_sleep(1)")).rejects.toMatchObject({ code: "57014" });
    await client.query("ROLLBACK TO SAVEPOINT t");
  });

  it.skipIf(!ownerUrl)("opstartstjekket afviser en forbindelse som ejeren abu_owner i produktion", async () => {
    const facts = await readDbRoleFacts(ownerUrl);
    expect(facts.ownsUserTable).toBe(true);
    expect(dbRoleProblems(facts).join(" ")).toMatch(/ejer tabeller/);
    const logs: string[] = [];
    await expect(assertDbRuntimeRole(ownerUrl, "production", (m) => logs.push(m))).rejects.toBeInstanceOf(EnvConfigError);
    expect(logs.join("\n")).toMatch(new RegExp(`rolle=${facts.user}`));
  });
});
