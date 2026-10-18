import { describe, expect, it } from "vitest";
import { parseCreateAdminArgs, seedRefusal } from "./admin-bootstrap";
import { asSystem, describeDb, uid } from "../test/db";

describe("create-admin (H-1)", () => {
  it("parser e-mail, navn og --reset", () => {
    expect(parseCreateAdminArgs(["--email", "Admin@Firma.dk", "--name", "Mette Admin"])).toEqual({ email: "admin@firma.dk", name: "Mette Admin", reset: false, resetMfa: false });
    expect(parseCreateAdminArgs(["--email=a@b.dk", "--reset"])).toEqual({ email: "a@b.dk", name: "", reset: true, resetMfa: false });
    expect(parseCreateAdminArgs(["--email", "mads@qlim8.com", "--name", "Mads"])).toEqual({ email: "mads@qlim8.com", name: "Mads", reset: false, resetMfa: false });
    // --reset-mfa er en nødprocedure og indebærer --reset (nyt link)
    expect(parseCreateAdminArgs(["--email", "a@b.dk", "--reset-mfa"])).toEqual({ email: "a@b.dk", name: "", reset: true, resetMfa: true });
  });
  it("afviser manglende eller ugyldige argumenter", () => {
    expect(parseCreateAdminArgs([])).toHaveProperty("error");
    expect(parseCreateAdminArgs(["--email", "ikke-en-mail", "--name", "X Y"])).toHaveProperty("error");
    expect(parseCreateAdminArgs(["--email", "a@b.dk"])).toHaveProperty("error"); // navn kræves for ny admin
    expect(parseCreateAdminArgs(["--email", "a@b.dk", "--name", "Ok Navn", "--password", "hemmelig"])).toHaveProperty("error");
    expect(parseCreateAdminArgs(["--email", "--name", "X"])).toHaveProperty("error");
  });
});

describe("create-admin spørger efter manglende værdier i en terminal", () => {
  it("bruger svarene, når flagene mangler, og kræver flag uden terminal", async () => {
    const { resolveCreateAdminArgs } = await import("./admin-bootstrap");
    const answers = ["Mads@Qlim8.com", "Mads"];
    const asked: string[] = [];
    const ask = async (q: string) => {
      asked.push(q);
      return answers.shift() ?? "";
    };
    expect(await resolveCreateAdminArgs([], ask)).toEqual({ email: "mads@qlim8.com", name: "Mads", reset: false, resetMfa: false });
    expect(asked).toHaveLength(2);
    expect(await resolveCreateAdminArgs(["--email", "a@b.dk", "--name", "Ok Navn"], async () => "x")).toMatchObject({ email: "a@b.dk", name: "Ok Navn" });
    expect(await resolveCreateAdminArgs([], null)).toHaveProperty("error");
    // Ingen adgangskode kan angives (H-1)
    expect(await resolveCreateAdminArgs(["--password", "Kort1234"], ask)).toHaveProperty("error");
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
  // create-admin kører som ejeren i systemkontekst («admin.bootstrap»)
  it("opretter admin uden adgangskode med et engangslink, og afviser dubletter uden --reset", () => asSystem(async () => {
    const { prisma } = await import("./db");
    const { createAdminInvite } = await import("./admin-bootstrap");
    const email = `${uid("admin")}@test.dk`;
    const r = await createAdminInvite(prisma, { email, name: "Test Admin", reset: false, resetMfa: false }, "https://abu.example.com/");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.link).toMatch(/^https:\/\/abu\.example\.com\/set-password\?token=[\w-]{40,}$/);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.role).toBe("ADMIN");
    expect(user.passwordHash).toBeNull();
    // Endnu ikke accepteret: et nyt kald udsteder et nyt link og ugyldiggør det gamle
    const again = await createAdminInvite(prisma, { email, name: "Test Admin", reset: false, resetMfa: false }, "https://abu.example.com");
    expect(again.ok).toBe(true);
    expect(await prisma.passwordToken.count({ where: { userId: user.id, usedAt: null } })).toBe(1);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: "x" } });
    const dup = await createAdminInvite(prisma, { email, name: "Test Admin", reset: false, resetMfa: false }, "https://abu.example.com");
    expect(dup).toEqual({ ok: false, error: expect.stringMatching(/--reset/) });
    const reset = await createAdminInvite(prisma, { email, name: "", reset: true, resetMfa: false }, "https://abu.example.com");
    expect(reset.ok && reset.link).toMatch(/&reset=1$/);
    // Nødprocedure: --reset-mfa fjerner MFA-data og logger ud, så MFA opsættes igen ved næste login
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabledAt: new Date(), mfaSecretEnc: "v1.x.y.z.w", deactivatedAt: new Date() } });
    await prisma.mfaRecoveryCode.create({ data: { userId: user.id, codeHash: "h" } });
    const mfa = await createAdminInvite(prisma, { email, name: "", reset: true, resetMfa: true }, "https://abu.example.com");
    expect(mfa.ok).toBe(true);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ mfaEnabledAt: null, mfaSecretEnc: null, deactivatedAt: null });
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    await prisma.user.delete({ where: { id: user.id } });
  }));
});
