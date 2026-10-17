import { describe, expect, it } from "vitest";
import { parseCreateAdminArgs, seedRefusal } from "./admin-bootstrap";
import { describeDb, uid } from "../test/db";

describe("create-admin (H-1)", () => {
  it("parser e-mail, navn og --reset", () => {
    expect(parseCreateAdminArgs(["--email", "Admin@Firma.dk", "--name", "Mette Admin"])).toEqual({ email: "admin@firma.dk", name: "Mette Admin", reset: false });
    expect(parseCreateAdminArgs(["--email=a@b.dk", "--reset"])).toEqual({ email: "a@b.dk", name: "", reset: true });
  });
  it("afviser manglende eller ugyldige argumenter", () => {
    expect(parseCreateAdminArgs([])).toHaveProperty("error");
    expect(parseCreateAdminArgs(["--email", "ikke-en-mail", "--name", "X Y"])).toHaveProperty("error");
    expect(parseCreateAdminArgs(["--email", "a@b.dk"])).toHaveProperty("error"); // navn kræves for ny admin
    expect(parseCreateAdminArgs(["--email", "a@b.dk", "--name", "Ok Navn", "--password", "hemmelig"])).toHaveProperty("error");
    expect(parseCreateAdminArgs(["--email", "--name", "X"])).toHaveProperty("error");
  });
});

describe("seed i produktion (H-1)", () => {
  it("afvises, når NODE_ENV=production eller APP_ENV=production", () => {
    expect(seedRefusal({ NODE_ENV: "production" })).toMatch(/Seed afvist/);
    expect(seedRefusal({ APP_ENV: "production" })).toMatch(/create-admin/);
  });
  it("tillades lokalt og når APP_ENV eksplicit er development/staging", () => {
    expect(seedRefusal({ NODE_ENV: "development" })).toBeNull();
    expect(seedRefusal({})).toBeNull();
    expect(seedRefusal({ NODE_ENV: "production", APP_ENV: "development" })).toBeNull();
  });
});

describeDb("createAdminInvite mod databasen (H-1)", () => {
  it("opretter admin uden adgangskode med et engangslink, og afviser dubletter uden --reset", async () => {
    const { prisma } = await import("./db");
    const { createAdminInvite } = await import("./admin-bootstrap");
    const email = `${uid("admin")}@test.dk`;
    const r = await createAdminInvite(prisma, { email, name: "Test Admin", reset: false }, "https://abu.example.com/");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.link).toMatch(/^https:\/\/abu\.example\.com\/set-password\?token=[\w-]{40,}$/);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.role).toBe("ADMIN");
    expect(user.passwordHash).toBeNull();
    // Endnu ikke accepteret: et nyt kald udsteder et nyt link og ugyldiggør det gamle
    const again = await createAdminInvite(prisma, { email, name: "Test Admin", reset: false }, "https://abu.example.com");
    expect(again.ok).toBe(true);
    expect(await prisma.passwordToken.count({ where: { userId: user.id, usedAt: null } })).toBe(1);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: "x" } });
    const dup = await createAdminInvite(prisma, { email, name: "Test Admin", reset: false }, "https://abu.example.com");
    expect(dup).toEqual({ ok: false, error: expect.stringMatching(/--reset/) });
    const reset = await createAdminInvite(prisma, { email, name: "", reset: true }, "https://abu.example.com");
    expect(reset.ok && reset.link).toMatch(/&reset=1$/);
    await prisma.user.delete({ where: { id: user.id } });
  });
});
