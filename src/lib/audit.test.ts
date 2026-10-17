import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("./db");
  vi.doUnmock("./alerts");
  vi.resetModules();
});

describe("audit-log (L-3)", () => {
  it("rejser en alarm, når audit-loggen ikke kan skrives, uden at kaste", async () => {
    vi.doMock("./db", () => ({ prisma: { auditLog: { create: vi.fn().mockRejectedValue(new Error("db nede")) } } }));
    const raiseAlert = vi.fn().mockResolvedValue(undefined);
    vi.doMock("./alerts", () => ({ raiseAlert }));
    const { audit } = await import("./audit");
    await expect(audit("u1", "user.delete", "User", "u2")).resolves.toBeUndefined();
    expect(raiseAlert).toHaveBeenCalledWith("audit_write_failed", expect.stringContaining("user.delete"));
  });

  it("alarmer skrives altid til loggen med [ALERT]-præfiks, også hvis de ikke kan gemmes", async () => {
    vi.doMock("./db", () => ({ prisma: { appSetting: { findUnique: vi.fn().mockRejectedValue(new Error("db nede")) } } }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { raiseAlert } = await import("./alerts");
    await raiseAlert("audit_write_failed", "test");
    expect(err.mock.calls[0][0]).toMatch(/^\[ALERT\] audit_write_failed: test/);
  });
});
