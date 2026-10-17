/* Seed: admin, 4 rådgivere, 1 demokunde med aktivt abonnement (3 rådgivere, hver 8. uge). */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ADVISORS = [
  {
    name: "Mette Lindberg",
    email: "mette.lindberg@abu.local",
    title: "Tidligere CFO, børsnoteret industrikoncern",
    bio: "Mette har 20 års erfaring som økonomichef og bestyrelsesmedlem. Hun hjælper med likviditetsstyring, finansiering og kapitalrejsning.",
    expertise: ["Økonomi", "Finansiering", "Kapitalrejsning"],
  },
  {
    name: "Jesper Holm Andersen",
    email: "jesper.andersen@abu.local",
    title: "Salgsdirektør og iværksætter",
    bio: "Jesper har opbygget salgsorganisationer i tre skalerende B2B-virksomheder. Fokus på pipeline, prissætning og kundeanskaffelse.",
    expertise: ["Salg", "Prissætning", "B2B-vækst"],
  },
  {
    name: "Camilla Strøm Nielsen",
    email: "camilla.nielsen@abu.local",
    title: "CTO og digital transformation",
    bio: "Camilla har ledet tech-teams på 5 til 150 medarbejdere og rådgiver om produktstrategi, arkitektur og AI i forretningen.",
    expertise: ["Teknologi", "Produkt", "AI"],
  },
  {
    name: "Søren Bjerregaard",
    email: "soeren.bjerregaard@abu.local",
    title: "HR-direktør og organisationsudvikler",
    bio: "Søren hjælper ledelser med rekruttering, kultur og ledelsesudvikling – især i virksomheder i hurtig vækst.",
    expertise: ["HR", "Ledelse", "Organisation"],
  },
];

async function main() {
  const adminHash = await bcrypt.hash("Admin123!", 12);
  const kundeHash = await bcrypt.hash("Kunde123!", 12);
  const advisorHash = await bcrypt.hash("Raadgiver123!", 12);

  await prisma.user.upsert({
    where: { email: "admin@abu.local" },
    update: {},
    create: { email: "admin@abu.local", name: "Admin", role: "ADMIN", passwordHash: adminHash },
  });

  const advisorIds: string[] = [];
  for (const a of ADVISORS) {
    const user = await prisma.user.upsert({
      where: { email: a.email },
      update: {},
      create: {
        email: a.email,
        name: a.name,
        role: "ADVISOR",
        passwordHash: advisorHash,
        advisorProfile: { create: { title: a.title, bio: a.bio, expertise: a.expertise, active: true } },
      },
    });
    advisorIds.push(user.id);
    const existing = await prisma.availabilityRule.count({ where: { advisorId: user.id } });
    if (existing === 0) {
      // Hverdage 09:00-16:00 (København-tid); torsdag formiddag kun for variation
      await prisma.availabilityRule.createMany({
        data: [1, 2, 3, 4, 5].map((weekday) => ({
          advisorId: user.id,
          weekday,
          startMinute: 9 * 60,
          endMinute: weekday === 4 ? 13 * 60 : 16 * 60,
        })),
      });
    }
  }

  const customer = await prisma.user.upsert({
    where: { email: "kunde@abu.local" },
    update: {},
    create: {
      email: "kunde@abu.local",
      name: "Kasper Kunde",
      phone: "+45 12 34 56 78",
      role: "CUSTOMER",
      passwordHash: kundeHash,
      consentAt: new Date(),
      customerProfile: {
        create: { companyName: "Demo ApS", cvr: "12345678", address: "Testvej 1, 2100 København Ø", billingEmail: "kunde@abu.local" },
      },
    },
  });

  const hasSub = await prisma.subscription.count({ where: { customerId: customer.id } });
  if (!hasSub) {
    await prisma.subscription.create({
      data: {
        customerId: customer.id,
        advisorCount: 3,
        frequencyWeeks: 8,
        monthlyPriceDkk: Math.round((3 * 1750 * (52 / 8)) / 12),
        status: "ACTIVE",
        provider: "mock",
        providerCustomerId: `mock-cust-${customer.id}`,
        startedAt: new Date(),
        advisors: { create: advisorIds.slice(0, 3).map((advisorId) => ({ advisorId })) },
      },
    });
  }

  console.log("Seed færdig.");
  console.log("  Admin:   admin@abu.local / Admin123!");
  console.log("  Kunde:   kunde@abu.local / Kunde123!");
  console.log("  Rådgiver (alle): <fornavn.efternavn>@abu.local / Raadgiver123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
