import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { describeDb, uid } from "../../test/db";

// Server actions kaldes direkte: requireRole returnerer en admin, og revalidatePath er en no-op uden for Next.
const adminRef = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireRole: vi.fn(async () => ({ id: adminRef.id, role: "ADMIN", name: "Admin" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("setAdvisorActiveAction uden database", () => {
  it("afviser en ugyldig ønsket tilstand", async () => {
    const { setAdvisorActiveAction } = await import("./admin");
    expect(await setAdvisorActiveAction({}, fd({ userId: "x", active: "toggle" }))).toMatchObject({ error: "Ugyldig handling." });
  });
});

describeDb("aktivering af rådgivere via server action (blokeret indtil klar)", () => {
  const ids: string[] = [];
  let tagId = "";

  beforeAll(async () => {
    const { prisma } = await import("@/lib/db");
    const admin = await prisma.user.create({ data: { email: `${uid("adm")}@test.dk`, name: "Admin", role: "ADMIN" } });
    adminRef.id = admin.id;
    ids.push(admin.id);
    tagId = (await prisma.tag.create({ data: { slug: uid("tag"), name: uid("Tag") } })).id;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.auditLog.deleteMany({ where: { userId: adminRef.id } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.tag.deleteMany({ where: { id: tagId } });
  });

  async function advisor(opts: { ready?: boolean; active?: boolean } = {}) {
    const { prisma } = await import("@/lib/db");
    const u = await prisma.user.create({
      data: {
        email: `${uid("adv")}@test.dk`,
        name: "Rikke Rådgiver",
        role: "ADVISOR",
        passwordHash: opts.ready ? "x" : null,
        advisorProfile: { create: { active: opts.active ?? false, bio: opts.ready ? "Erfaren" : "", pricePerMeetingDkk: 1750 } },
      },
    });
    ids.push(u.id);
    if (opts.ready) {
      await prisma.advisorTag.create({ data: { advisorId: u.id, tagId } });
      await prisma.availabilityRule.create({ data: { advisorId: u.id, weekday: 1, startMinute: 540, endMinute: 960 } });
    }
    return u.id;
  }

  const activeOf = async (id: string) => (await (await import("@/lib/db")).prisma.advisorProfile.findUniqueOrThrow({ where: { userId: id } })).active;
  const audits = async (id: string) =>
    (await (await import("@/lib/db")).prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);

  it("afviser aktivering af en nyinviteret rådgiver med en dansk liste over det, der mangler", async () => {
    const { setAdvisorActiveAction } = await import("./admin");
    const id = await advisor();
    const r = await setAdvisorActiveAction({}, fd({ userId: id, active: "true" }));
    expect(r.ok).toBeUndefined();
    expect(r.error).toBe(
      "Rikke Rådgiver kan ikke aktiveres endnu. Mangler: invitation accepteret, mindst ét kompetence-tag, ugentlig tilgængelighed, præsentation (bio).",
    );
    expect(await activeOf(id)).toBe(false);
    expect(await audits(id)).toEqual(["advisor.activate.blocked"]);
  });

  it("afviser aktivering, når pris er uden for intervallet, selv om resten er klar", async () => {
    const { prisma } = await import("@/lib/db");
    const { setAdvisorActiveAction } = await import("./admin");
    const id = await advisor({ ready: true });
    await prisma.advisorProfile.update({ where: { userId: id }, data: { pricePerMeetingDkk: 10 } });
    const r = await setAdvisorActiveAction({}, fd({ userId: id, active: "true" }));
    expect(r.error).toMatch(/Mangler: pris pr\. møde\./);
    expect(await activeOf(id)).toBe(false);
  });

  it("aktiverer, når tjeklisten er opfyldt, og audit-logger", async () => {
    const { setAdvisorActiveAction } = await import("./admin");
    const id = await advisor({ ready: true });
    const r = await setAdvisorActiveAction({}, fd({ userId: id, active: "true" }));
    expect(r).toMatchObject({ ok: "Rikke Rådgiver er aktiveret og kan nu vælges af kunder." });
    expect(await activeOf(id)).toBe(true);
    // Samme ønske igen (dobbeltklik) er idempotent: ingen ny audit-linje
    await setAdvisorActiveAction({}, fd({ userId: id, active: "true" }));
    expect(await audits(id)).toEqual(["advisor.activate"]);
  });

  it("deaktivering er altid tilladt – også når rådgiveren ikke længere er klar – og nævner berørte boards", async () => {
    const { prisma } = await import("@/lib/db");
    const { setAdvisorActiveAction } = await import("./admin");
    const id = await advisor({ active: true }); // aktiv, men opfylder ikke tjeklisten
    const email = `${uid("kunde")}@test.dk`;
    const c = await prisma.user.create({ data: { email, name: "K", role: "CUSTOMER", customerProfile: { create: { companyName: "Fjord Byg ApS", cvr: "1", billingEmail: email } } } });
    ids.push(c.id);
    await prisma.subscription.create({
      data: { customerId: c.id, advisorCount: 2, frequencyWeeks: 8, monthlyPriceDkk: 1, status: "ACTIVE", provider: "mock", advisors: { create: [{ advisorId: id, pricePerMeetingDkk: 1750 }] } },
    });
    const r = await setAdvisorActiveAction({}, fd({ userId: id, active: "false" }));
    expect(r.ok).toBe("Rikke Rådgiver er deaktiveret. Berørte kunder (vælg en ny rådgiver under Abonnementer): Fjord Byg ApS.");
    expect(await activeOf(id)).toBe(false);
    expect(await audits(id)).toEqual(["advisor.deactivate"]);
  });

  it("updateAdvisorAction kan ikke ændre aktiv-status (et forfalsket felt ignoreres)", async () => {
    const { updateAdvisorAction } = await import("./cms");
    const id = await advisor();
    const r = await updateAdvisorAction(id, { priceDkk: 1750, tagIds: [], active: true } as never);
    expect(r.ok).toBe(true);
    expect(await activeOf(id)).toBe(false);
  });
});
