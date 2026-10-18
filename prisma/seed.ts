/* Seed: admin, tags, 8 rådgivere, onboarding-test og 1 demokunde med aktivt abonnement (3 rådgivere, hver 8. uge). */
import bcrypt from "bcryptjs";
import { seedRefusal } from "../src/lib/admin-bootstrap";
import { prisma } from "../src/lib/db";
import { monthlyPriceForBoard } from "../src/lib/pricing";
import { ensureNotificationDefaults } from "../src/lib/notifications/service";
import { ADVISORS, DEMO_BOARD_EMAILS, QUESTIONS, TAGS } from "./seed-data";

async function main() {
  // H-1: demodata med kendte adgangskoder må aldrig ende i produktion
  const refusal = seedRefusal(process.env);
  if (refusal) {
    console.error(refusal);
    process.exitCode = 1;
    return;
  }
  // Demobrugerne har givet samtykke til optagelse (version 0 = standardteksten)
  const consent = { recordingConsentAt: new Date(), recordingConsentVersion: "r0" };
  const adminHash = await bcrypt.hash("Admin12345!", 12);
  const kundeHash = await bcrypt.hash("Kunde12345!", 12);
  const advisorHash = await bcrypt.hash("Raadgiver123!", 12);

  await prisma.user.upsert({
    where: { email: "admin@abu.local" },
    update: {},
    create: { email: "admin@abu.local", name: "Admin", role: "ADMIN", passwordHash: adminHash, ...consent },
  });

  const tagIds = new Map<string, string>();
  for (const [i, t] of TAGS.entries()) {
    const tag = await prisma.tag.upsert({
      where: { slug: t.slug },
      update: {},
      create: { slug: t.slug, name: t.name, description: t.description, sortOrder: (i + 1) * 10 },
    });
    tagIds.set(t.slug, tag.id);
  }

  const advisorIds = new Map<string, string>();
  for (const [i, a] of ADVISORS.entries()) {
    const user = await prisma.user.upsert({
      where: { email: a.email },
      update: {},
      create: {
        email: a.email,
        name: a.name,
        role: "ADVISOR",
        phone: `+45 20 10 00 ${String(i + 1).padStart(2, "0")}`, // fiktive testnumre til SMS
        passwordHash: advisorHash,
        ...consent,
        advisorProfile: { create: { title: a.title, bio: a.bio, active: true, pricePerMeetingDkk: a.price } },
      },
    });
    advisorIds.set(a.email, user.id);
    await prisma.advisorTag.createMany({
      data: a.tags.map((slug) => ({ advisorId: user.id, tagId: tagIds.get(slug)! })),
      skipDuplicates: true,
    });
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
      ...consent,
      customerProfile: {
        create: { companyName: "Demo ApS", cvr: "30000102", address: "Testvej 1, 2100 København Ø", billingEmail: "kunde@abu.local" },
      },
    },
  });

  if ((await prisma.onboardingQuestion.count()) === 0) {
    for (const [qi, q] of QUESTIONS.entries()) {
      await prisma.onboardingQuestion.create({
        data: {
          text: q.text,
          helpText: q.helpText,
          type: q.type,
          sortOrder: (qi + 1) * 10,
          answers: {
            create: q.answers.map((a, ai) => ({
              text: a.text,
              sortOrder: (ai + 1) * 10,
              boardSize: a.boardSize,
              weights: { create: Object.entries(a.weights).map(([slug, weight]) => ({ tagId: tagIds.get(slug)!, weight })) },
            })),
          },
        },
      });
    }
  }

  const hasSub = await prisma.subscription.count({ where: { customerId: customer.id } });
  if (!hasSub) {
    await prisma.subscription.create({
      data: {
        customerId: customer.id,
        // Møder holdes altid med hele boardet: advisorCount = antal rådgivere i boardet
        advisorCount: DEMO_BOARD_EMAILS.length,
        frequencyWeeks: 8,
        monthlyPriceDkk: monthlyPriceForBoard(
          DEMO_BOARD_EMAILS.map((e) => ADVISORS.find((a) => a.email === e)!.price),
          8,
        ),
        status: "ACTIVE",
        provider: "mock",
        providerCustomerId: `mock-cust-${customer.id}`,
        startedAt: new Date(),
        advisors: {
          create: DEMO_BOARD_EMAILS.map((e) => ({
            advisorId: advisorIds.get(e)!,
            pricePerMeetingDkk: ADVISORS.find((a) => a.email === e)!.price,
          })),
        },
      },
    });
  }

  // Danske standardtekster og -regler til notifikationer (e-mail og SMS)
  const n = await ensureNotificationDefaults();
  console.log(`Notifikationer: ${n.templates} skabeloner og ${n.rules} regler oprettet.`);

  console.log("Seed færdig.");
  console.log("  Admin:   admin@abu.local / Admin12345!");
  console.log("  Kunde:   kunde@abu.local / Kunde12345!");
  console.log("  Rådgiver (alle): <fornavn.efternavn>@abu.local / Raadgiver123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
