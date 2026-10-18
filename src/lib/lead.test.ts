import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeDb, uid, ownerDb } from "../test/db";
import { leadCounts, leadSpread, pickLead, proposeBalancing, type BalanceBoard } from "./lead";
import { suggestBoard, type MatchAdvisor } from "./matching";

describe("ansvarlig rådgiver: tildeling (ren funktion)", () => {
  const c = (id: string, leadCount: number, seatCount = 0, priceDkk = 1750, name = id) => ({ id, name, priceDkk, leadCount, seatCount });
  it("færrest ansvarsroller → færrest pladser → laveste pris → navn", () => {
    expect(pickLead([c("a", 2), c("b", 1), c("c", 3)])).toBe("b");
    expect(pickLead([c("a", 1, 4), c("b", 1, 2)])).toBe("b");
    expect(pickLead([c("a", 1, 2, 2000), c("b", 1, 2, 1500)])).toBe("b");
    expect(pickLead([c("x", 0, 0, 1750, "Ørsted"), c("y", 0, 0, 1750, "Andersen")])).toBe("y");
    expect(pickLead([])).toBeNull();
  });
});

describe("udligning (ren funktion)", () => {
  it("3 boards ledet af A, hvor B og C er kvalificerede i nogle af dem → spredes ud", () => {
    const boards: BalanceBoard[] = [
      { subscriptionId: "s1", label: "Alfa", leadId: "A", eligibleIds: ["A", "B"] },
      { subscriptionId: "s2", label: "Beta", leadId: "A", eligibleIds: ["A", "B"] },
      { subscriptionId: "s3", label: "Gamma", leadId: "A", eligibleIds: ["A", "C"] },
    ];
    expect(leadSpread(leadCounts(boards))).toBe(3);
    const moves = proposeBalancing(boards);
    expect(moves).toHaveLength(2);
    const after = leadCounts(boards.map((b) => ({ ...b, leadId: moves.find((m) => m.subscriptionId === b.subscriptionId)?.to ?? b.leadId })));
    expect(Object.fromEntries(after)).toEqual({ A: 1, B: 1, C: 1 });
    expect(leadSpread(after)).toBe(0);
    // Flytninger sker kun til kvalificerede medlemmer af samme board
    for (const m of moves) expect(boards.find((b) => b.subscriptionId === m.subscriptionId)!.eligibleIds).toContain(m.to);
  });

  it("intet forslag, når det ikke kan blive jævnere, og boards uden ansvarlig røres ikke", () => {
    expect(proposeBalancing([
      { subscriptionId: "s1", label: "A", leadId: "A", eligibleIds: ["A", "B"] },
      { subscriptionId: "s2", label: "B", leadId: "B", eligibleIds: ["A", "B"] },
    ])).toEqual([]);
    // A leder to boards, men B kan kun overtage ét af dem → forskel 2 → 0 med én flytning
    expect(proposeBalancing([
      { subscriptionId: "s1", label: "A", leadId: "A", eligibleIds: ["A"] },
      { subscriptionId: "s2", label: "B", leadId: "A", eligibleIds: ["A", "B"] },
      { subscriptionId: "s3", label: "C", leadId: null, eligibleIds: [] },
    ])).toEqual([{ subscriptionId: "s2", label: "B", from: "A", to: "B" }]);
  });
});

describe("besked ved ny ansvarlig rådgiver", () => {
  it("tilpasses modtageren", async () => {
    const { describeLeadChange } = await import("./notifications/variables");
    const base = { company: "Demo ApS", lead: "Louise", previous: "Jesper" };
    expect(describeLeadChange({ ...base, role: "customer" })).toBe("Louise er nu ansvarlig rådgiver for jeres board i stedet for Jesper.");
    expect(describeLeadChange({ ...base, role: "lead" })).toBe("Du er nu ansvarlig rådgiver for boardet hos Demo ApS og overtager efter Jesper.");
    expect(describeLeadChange({ ...base, role: "previous" })).toBe("Louise er nu ansvarlig rådgiver for boardet hos Demo ApS i stedet for dig.");
  });
});

describe("matching: boardet får altid en rådgiver, der kan være ansvarlig", () => {
  const adv = (id: string, tagIds: string[], leadEligible = false, priceDkk = 1750): MatchAdvisor => ({ id, name: id, priceDkk, active: true, tagIds, leadEligible });
  const answers = [{ tagWeights: [{ tagId: "t1", weight: 5 }, { tagId: "t2", weight: 4 }, { tagId: "t3", weight: 3 }] }];

  it("erstatter medlemmet med det mindste bidrag med den bedst scorende kvalificerede", () => {
    const r = suggestBoard([adv("a", ["t1"]), adv("b", ["t2"]), adv("c", ["t3"]), adv("L", ["t3", "x"], true), adv("M", [], true)], [...answers, { tagWeights: [], boardSize: 3 }]);
    expect(r.advisorIds).toHaveLength(3);
    expect(r.advisorIds).toContain("L");
    expect(r.advisorIds).not.toContain("c");
    expect(r.leadAdjustment).toEqual({ kind: "replaced", inId: "L", outId: "c" });
  });

  it("ingen justering, når boardet allerede har en kvalificeret", () => {
    const r = suggestBoard([adv("a", ["t1"], true), adv("b", ["t2"]), adv("c", ["t3"])], answers);
    expect(r.leadAdjustment).toBeNull();
  });

  it("ingen kvalificerede i kataloget: boardet er uændret (valideringen blokerer senere)", () => {
    const r = suggestBoard([adv("a", ["t1"]), adv("b", ["t2"])], answers);
    expect(r.leadAdjustment).toBeNull();
    expect(r.advisorIds.sort()).toEqual(["a", "b"]);
  });
});

describeDb("ansvarlig rådgiver i databasen", () => {
  const ids: string[] = [];
  let leadTag = "";
  beforeAll(async () => {
    const { getLeadTagId } = await import("./lead");
    leadTag = await getLeadTagId();
  });
  afterAll(async () => {
    const { prisma } = await import("./db");
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  const advisor = async (name: string, lead: boolean, priceDkk = 1750) => {
    const { prisma } = await import("./db");
    const u = await prisma.user.create({
      data: { email: `${uid("adv")}@test.dk`, name, role: "ADVISOR", passwordHash: "x", advisorProfile: { create: { active: true, bio: "x", pricePerMeetingDkk: priceDkk } } },
    });
    ids.push(u.id);
    if (lead) await prisma.advisorTag.create({ data: { advisorId: u.id, tagId: leadTag } });
    return u.id;
  };
  const board = async (advisorIds: string[]) => {
    const { prisma } = await import("./db");
    const email = `${uid("k")}@test.dk`;
    const c = await prisma.user.create({ data: { email, name: "K", role: "CUSTOMER", customerProfile: { create: { companyName: uid("Firma"), cvr: "1", billingEmail: email } } } });
    ids.push(c.id);
    return prisma.subscription.create({
      data: { customerId: c.id, advisorCount: advisorIds.length, frequencyWeeks: 8, monthlyPriceDkk: 1, status: "ACTIVE", provider: "mock", advisors: { create: advisorIds.map((advisorId) => ({ advisorId })) } },
    });
  };
  const leadOf = async (subscriptionId: string) =>
    (await (await import("./db")).prisma.subscriptionAdvisor.findFirst({ where: { subscriptionId, isLead: true } }))?.advisorId ?? null;

  it("tildeler den mindst belastede kvalificerede og balancerer over flere boards", async () => {
    const { prisma } = await import("./db");
    const { assignLeadTx } = await import("./lead");
    const [a, b, plain] = [await advisor("Anna", true), await advisor("Bo", true), await advisor("Ikke-lead", false)];
    const s1 = await board([a, b, plain]);
    const s2 = await board([a, b, plain]);
    await prisma.$transaction((tx) => assignLeadTx(tx, s1.id));
    await prisma.$transaction((tx) => assignLeadTx(tx, s2.id));
    const leads = [await leadOf(s1.id), await leadOf(s2.id)];
    expect(leads.sort()).toEqual([a, b].sort());
    expect(leads).not.toContain(plain);
  });

  it("højst én ansvarlig pr. board (delvist unikt indeks)", async () => {
    const { prisma } = await import("./db");
    const [a, b] = [await advisor("A", true), await advisor("B", true)];
    const s = await board([a, b]);
    await prisma.subscriptionAdvisor.update({ where: { subscriptionId_advisorId: { subscriptionId: s.id, advisorId: a } }, data: { isLead: true } });
    await expect(prisma.subscriptionAdvisor.update({ where: { subscriptionId_advisorId: { subscriptionId: s.id, advisorId: b } }, data: { isLead: true } })).rejects.toThrow();
  });

  it("deaktivering og fjernet lead-tag giver en ny ansvarlig; ingen kvalificeret → vises som board uden ansvarlig", async () => {
    const { prisma } = await import("./db");
    const { ensureLead, loadLeadOverview, reassignLeadsFrom } = await import("./lead");
    const [a, b, plain] = [await advisor("Aase", true), await advisor("Bent", true), await advisor("Carl", false)];
    const s = await board([a, b, plain]);
    await ensureLead(s.id, "created");
    const first = (await leadOf(s.id))!;
    expect([a, b]).toContain(first);
    const second = first === a ? b : a;
    await prisma.advisorProfile.update({ where: { userId: first }, data: { active: false } });
    await reassignLeadsFrom(first, "deactivated");
    expect(await leadOf(s.id)).toBe(second);
    await prisma.advisorTag.delete({ where: { advisorId_tagId: { advisorId: second, tagId: leadTag } } });
    await reassignLeadsFrom(second, "tag_removed");
    expect(await leadOf(s.id)).toBeNull();
    expect((await loadLeadOverview()).withoutLead.find((x) => x.subscriptionId === s.id)).toMatchObject({ hasEligible: false });
  });

  it("manuel ændring kun til kvalificerede medlemmer; udligning anvendes og audit-logges", async () => {
    const { prisma } = await import("./db");
    const { applyBalancing, ensureLead, setLeadManually } = await import("./lead");
    const admin = await prisma.user.create({ data: { email: `${uid("adm")}@test.dk`, name: "Admin", role: "ADMIN" } });
    ids.push(admin.id);
    const [a, b, plain] = [await advisor("Ane", true), await advisor("Bjørn", true), await advisor("Ikke", false)];
    const s = await board([a, b, plain]);
    await ensureLead(s.id, "created");
    expect(await setLeadManually(admin.id, s.id, plain)).toEqual({ ok: false, error: expect.stringMatching(/kan ikke være ansvarlig/) });
    const other = (await leadOf(s.id)) === a ? b : a;
    expect(await setLeadManually(admin.id, s.id, other)).toEqual({ ok: true, changed: true });
    expect(await leadOf(s.id)).toBe(other);
    // Forældet flytning springes over; gyldig anvendes
    const back = other === a ? b : a;
    expect(await applyBalancing(admin.id, [{ subscriptionId: s.id, from: back, to: other }])).toEqual({ applied: 0, skipped: 1 });
    expect(await applyBalancing(admin.id, [{ subscriptionId: s.id, from: other, to: back }])).toEqual({ applied: 1, skipped: 0 });
    const actions = (await prisma.auditLog.findMany({ where: { entityId: s.id, userId: admin.id } })).map((l) => l.action).sort();
    expect(actions).toEqual(["subscription.lead.balance", "subscription.lead.set"]);
    await (await ownerDb()).auditLog.deleteMany({ where: { userId: admin.id } });
  });

  it("kataloget viser aldrig admin-tags, men markerer hvem der kan være ansvarlig", async () => {
    const { loadCatalog } = await import("./onboarding/catalog");
    const l = await advisor("Katalog-lead", true);
    const cat = await loadCatalog();
    expect(cat.tags.some((t) => t.id === leadTag)).toBe(false);
    const row = cat.advisors.find((x) => x.id === l)!;
    expect(row.leadEligible).toBe(true);
    expect(row.tags.some((t) => t.id === leadTag)).toBe(false);
  });

  it("et board uden kvalificeret rådgiver afvises (resolveBoard)", async () => {
    const { resolveBoard } = await import("./onboarding/board");
    const { NO_LEAD_ELIGIBLE_ERROR } = await import("./lead");
    const [x, y, l] = [await advisor("X", false), await advisor("Y", false), await advisor("L", true)];
    expect(await resolveBoard([x, y], 8)).toEqual({ error: NO_LEAD_ELIGIBLE_ERROR });
    expect(await resolveBoard([x, l], 8)).toMatchObject({ weeks: 8 });
  });
});
