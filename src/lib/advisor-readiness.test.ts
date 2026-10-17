import { describe, expect, it } from "vitest";
import { describeDb, uid } from "../test/db";
import { advisorReadiness, missingReadiness } from "./advisor-readiness";
import { rankSubstituteCandidates } from "./substitutes";
import { toMatchAdvisors } from "./onboarding/catalog";

describe("aktivering af rådgivere (QA #13, ejerens beslutning)", () => {
  it("tjeklisten viser hvad der mangler (advarsel, ikke blokering)", () => {
    const items = advisorReadiness({ inviteAccepted: false, tagCount: 0, ruleCount: 2, bio: " ", priceDkk: 1750, priceBounds: { min: 500, max: 25000 } });
    expect(items.map((i) => [i.key, i.ok])).toEqual([["invite", false], ["tags", false], ["availability", true], ["bio", false], ["price", true]]);
    expect(missingReadiness(items)).toEqual(["invitation accepteret", "mindst ét kompetence-tag", "præsentation (bio)"]);
    expect(advisorReadiness({ inviteAccepted: true, tagCount: 1, ruleCount: 1, bio: "x", priceDkk: 100, priceBounds: { min: 500, max: 25000 } }).find((i) => i.key === "price")?.ok).toBe(false);
  });

  it("inaktive foreslås aldrig i matching", () => {
    const m = toMatchAdvisors([
      { id: "a", name: "A", title: "", bio: "", photoUrl: "", priceDkk: 1, tags: [{ id: "t", name: "T" }] },
      { id: "b", name: "B", title: "", bio: "", photoUrl: "", priceDkk: 1, tags: [{ id: "t", name: "T" }], inactive: true },
    ]);
    expect(m.map((x) => x.id)).toEqual(["a"]);
  });

  it("inaktive kandidater til udskiftning sorteres sidst og er aldrig ledige", () => {
    const r = rankSubstituteCandidates(
      [
        { id: "i", name: "Inaktiv", title: "", priceDkk: 1, tagIds: ["t"], available: false, conflict: "Inaktiv", inactive: true },
        { id: "o", name: "Optaget", title: "", priceDkk: 1, tagIds: [], available: false, conflict: "Har et andet møde" },
        { id: "l", name: "Ledig", title: "", priceDkk: 1, tagIds: [], available: true },
      ],
      { t: 5 },
    );
    expect(r.map((c) => c.id)).toEqual(["l", "o", "i"]);
  });
});

describeDb("inaktive rådgivere kan ikke vælges (QA #13)", () => {
  it("katalog, board-validering og nye rådgivere", async () => {
    const { prisma } = await import("./db");
    const { loadCatalog } = await import("./onboarding/catalog");
    const { resolveBoard } = await import("./onboarding/board");
    const mk = (active?: boolean) =>
      prisma.user.create({ data: { email: `${uid("adv")}@test.dk`, name: "R", role: "ADVISOR", advisorProfile: { create: active === undefined ? {} : { active } } } });
    const fresh = await mk(); // standard: inaktiv
    const on = await mk(true);
    expect((await prisma.advisorProfile.findUniqueOrThrow({ where: { userId: fresh.id } })).active).toBe(false);
    const ids = (await loadCatalog()).advisors.map((a) => a.id);
    expect(ids).toContain(on.id);
    expect(ids).not.toContain(fresh.id);
    expect(await resolveBoard([on.id, fresh.id], 8)).toEqual({ error: expect.stringMatching(/ikke længere tilgængelig/) });
    // Admin ser et eksisterende board med en inaktiv rådgiver markeret
    const adminView = await loadCatalog({ includeIds: [fresh.id] });
    expect(adminView.advisors.find((a) => a.id === fresh.id)?.inactive).toBe(true);
    await prisma.user.deleteMany({ where: { id: { in: [fresh.id, on.id] } } });
  });
});
