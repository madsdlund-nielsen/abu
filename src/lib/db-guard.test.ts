import { describe, expect, it } from "vitest";
import { assertDbRuntimeRole, dbRoleProblems, type DbRoleFacts } from "./db-guard";
import { EnvConfigError } from "./env";

const APP: DbRoleFacts = {
  user: "abu_app",
  superuser: false,
  bypassRls: false,
  createRole: false,
  createDb: false,
  ownedObjects: 0,
  ownsUserTable: false,
  ownsDatabase: false,
  schemaCreate: false,
  ssl: true,
};
const OWNER: DbRoleFacts = { ...APP, user: "abu_owner", ownedObjects: 115, ownsUserTable: true, ownsDatabase: true, schemaCreate: true };

describe("opstartstjek af databaserollen (C-1 / RLS fase 0)", () => {
  it("app-rollen uden særrettigheder er OK", () => {
    expect(dbRoleProblems(APP)).toEqual([]);
  });

  it("afviser superbruger, BYPASSRLS, CREATEROLE/CREATEDB, ejerskab og DDL-ret", () => {
    expect(dbRoleProblems({ ...APP, superuser: true }).join()).toMatch(/superbruger/);
    expect(dbRoleProblems({ ...APP, bypassRls: true }).join()).toMatch(/BYPASSRLS/);
    expect(dbRoleProblems({ ...APP, createRole: true }).join()).toMatch(/CREATEROLE/);
    expect(dbRoleProblems({ ...APP, createDb: true }).join()).toMatch(/CREATEDB/);
    expect(dbRoleProblems({ ...APP, ownsUserTable: true }).join()).toMatch(/ejer tabeller/);
    expect(dbRoleProblems({ ...APP, ownedObjects: 1 }).join()).toMatch(/ejer tabeller/);
    expect(dbRoleProblems({ ...APP, schemaCreate: true }).join()).toMatch(/DDL/);
    expect(dbRoleProblems({ ...APP, ownsUserTable: null }).join()).toMatch(/migrationerne/);
    expect(dbRoleProblems(OWNER).length).toBeGreaterThanOrEqual(3);
  });

  it("produktion: ejeren afvises (appen starter ikke); rollenavnet logges, URL og adgangskode aldrig", async () => {
    const logs: string[] = [];
    const url = "postgresql://abu_owner:SuperHemmeligAdgangskode123456@db/abu";
    await expect(assertDbRuntimeRole(url, "production", (m) => logs.push(m), async () => OWNER)).rejects.toBeInstanceOf(EnvConfigError);
    expect(logs.join("\n")).toMatch(/rolle=abu_owner/);
    expect(logs.join("\n")).not.toMatch(/SuperHemmelig/);
    await expect(assertDbRuntimeRole(url, "production", () => {}, async () => APP)).resolves.toEqual(APP);
  });

  it("produktion er fail-closed, hvis databasen ikke kan nås; udvikling advarer kun", async () => {
    const down = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    await expect(assertDbRuntimeRole("postgresql://x@db/abu", "production", () => {}, down)).rejects.toThrow(/kunne ikke kontrolleres/);
    const logs: string[] = [];
    await expect(assertDbRuntimeRole("postgresql://x@db/abu", "development", (m) => logs.push(m), down)).resolves.toBeNull();
    await expect(assertDbRuntimeRole("postgresql://x@db/abu", "development", (m) => logs.push(m), async () => OWNER)).resolves.toEqual(OWNER);
    expect(logs.join("\n")).toMatch(/ADVARSEL/);
  });
});
