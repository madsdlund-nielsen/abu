import { describe, expect, it } from "vitest";
import { APP_DB_TIMEOUTS, parseDbUrl, pgPoolConfig, sslOptions, tlsExemptDbHost } from "./db-config";

describe("databaseforbindelse: URL, TLS, pool og timeouts (RLS fase 0)", () => {
  it("fortolker vært, rolle, database og sslmode – og fjerner TLS-parametrene fra forbindelses-URL'en", () => {
    const db = parseDbUrl("postgresql://abu_app:hemmelig@db.internal:6432/abu?sslmode=verify-full&sslrootcert=/etc/ca.pem&application_name=x");
    expect(db).toMatchObject({ host: "db.internal", user: "abu_app", password: "hemmelig", database: "abu", socket: false, sslmode: "verify-full", sslrootcert: "/etc/ca.pem" });
    expect(db.connectionString).not.toMatch(/sslmode|sslrootcert/);
    expect(db.connectionString).toMatch(/application_name=x/);
    expect(parseDbUrl("postgresql://abu_app@localhost/abu?host=/var/run/postgresql")).toMatchObject({ host: "/var/run/postgresql", socket: true, sslmode: null });
    expect(parseDbUrl("postgresql://u:p@[::1]:5432/abu").host).toBe("::1");
  });

  it("afviser ugyldige URL'er og sslmode'r, node-postgres ikke kan overholde (prefer/allow)", () => {
    expect(() => parseDbUrl("ikke en url")).toThrow(/gyldig postgresql/);
    expect(() => parseDbUrl("mysql://x@y/z")).toThrow(/postgresql:\/\//);
    expect(() => parseDbUrl("postgresql://x@y/z?sslmode=prefer")).toThrow(/sslmode=prefer understøttes ikke/);
  });

  it("TLS-undtagelsen gælder kun socket, loopback og compose-databasen «postgres»", () => {
    for (const h of ["/var/run/postgresql", "localhost", "127.0.0.1", "127.0.0.53", "::1", "postgres"]) expect(tlsExemptDbHost(h)).toBe(true);
    for (const h of ["db.internal", "10.0.0.5", "postgres.example.com", "abu-db", "localhost.evil.com"]) expect(tlsExemptDbHost(h)).toBe(false);
  });

  it("sslmode følger libpq: require krypterer uden tjek (med CA: som verify-ca), verify-full tjekker CA og værtsnavn", () => {
    expect(sslOptions(null, undefined)).toBe(false);
    expect(sslOptions("disable", "CA")).toBe(false);
    expect(sslOptions("require", undefined)).toEqual({ rejectUnauthorized: false });
    const reqCa = sslOptions("require", "CA") as { ca: string; rejectUnauthorized: boolean; checkServerIdentity: () => undefined };
    expect(reqCa).toMatchObject({ ca: "CA", rejectUnauthorized: true });
    expect(reqCa.checkServerIdentity()).toBeUndefined();
    expect(sslOptions("verify-ca", "CA")).toMatchObject({ ca: "CA", rejectUnauthorized: true, checkServerIdentity: expect.any(Function) });
    const full = sslOptions("verify-full", "CA") as Record<string, unknown>;
    expect(full).toEqual({ ca: "CA", rejectUnauthorized: true });
    expect(sslOptions("verify-full", undefined)).toEqual({ rejectUnauthorized: true });
  });

  it("pool: DATABASE_POOL_MAX (standard 10), CA fra DATABASE_SSL_CA og appens timeouts på hver forbindelse", () => {
    const read = (p: string) => `PEM:${p}`;
    const cfg = pgPoolConfig("postgresql://abu_app:x@db.internal/abu?sslmode=verify-full", { DATABASE_SSL_CA: "/run/ca.pem", DATABASE_POOL_MAX: "4" }, read);
    expect(cfg).toMatchObject({ max: 4, ssl: { ca: "PEM:/run/ca.pem", rejectUnauthorized: true }, ...APP_DB_TIMEOUTS });
    expect(cfg.connectionString).toBe("postgresql://abu_app:x@db.internal/abu");
    expect(APP_DB_TIMEOUTS).toEqual({ statement_timeout: 15_000, lock_timeout: 10_000, idle_in_transaction_session_timeout: 30_000 });
    expect(pgPoolConfig("postgresql://a@localhost/abu", {}).max).toBe(10);
    expect(pgPoolConfig("postgresql://a@localhost/abu", { DATABASE_POOL_MAX: "0" }).max).toBe(10);
    expect(pgPoolConfig("postgresql://a@localhost/abu?sslrootcert=/x.pem&sslmode=verify-ca", {}, read).ssl).toMatchObject({ ca: "PEM:/x.pem" });
  });
});
