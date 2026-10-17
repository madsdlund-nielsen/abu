"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import { recordingConsentNow } from "@/lib/consent";
import { currentConsent } from "@/lib/content/server";
import { convertLead, upsertLead } from "@/lib/leads";
import { createSession, hashPassword } from "@/lib/auth";
import { getClientIp } from "@/lib/client-ip";
import { rateLimit, rateLimitIp } from "@/lib/rate-limit";
import { startCheckout } from "@/lib/checkout";
import { lookupCvr } from "@/lib/cvr";
import { prisma } from "@/lib/db";
import { suggestBoard } from "@/lib/matching";
import { resolveBoard } from "@/lib/onboarding/board";
import { loadActiveQuestions, loadCatalog, selectedMatchAnswers, toMatchAdvisors } from "@/lib/onboarding/catalog";
import { accountSchema, answerSchema, boardSchema, companyStepSchema, contactSchema, manualCompanySchema } from "@/lib/onboarding/schemas";
import {
  asSuggestion,
  createOnboardingSession,
  getOnboardingSession,
  updateOnboardingSession,
  type CompanyState,
  type OnboardingState,
} from "@/lib/onboarding/session";
import { buildTestSnapshot } from "@/lib/onboarding/snapshot";

const BASE = "/kom-i-gang";
const to = (step: number, extra = "") => `${BASE}?trin=${step}${extra}`;
const fail = (step: number, message: string, extra = ""): never => redirect(`${to(step, extra)}&err=${encodeURIComponent(message)}`);

async function need(minStep: number): Promise<OnboardingState> {
  const s = await getOnboardingSession();
  if (!s) redirect(BASE);
  if (s.step < minStep) redirect(to(s.step));
  return s;
}

/** Trin 1: kontaktperson. Opretter sessionen (og cookien). */
export async function saveContactAction(formData: FormData) {
  if (!(await rateLimitIp("onb-contact", await getClientIp(), 30))) fail(1, "For mange forsøg. Prøv igen senere.");
  const parsed = contactSchema.safeParse({ name: formData.get("name"), email: formData.get("email") });
  // Ved fejl sendes de indtastede værdier med tilbage, så kunden ikke skal skrive dem igen
  const keep = `&n=${encodeURIComponent(String(formData.get("name") ?? ""))}&e=${encodeURIComponent(String(formData.get("email") ?? ""))}`;
  if (!parsed.success) fail(1, parsed.error.issues[0].message, keep);
  const contact = parsed.data!;
  const exists = await prisma.user.findUnique({ where: { email: contact.email }, select: { id: true } });
  if (exists) fail(1, "Der findes allerede en konto med den e-mail.", `&konto=1${keep}`);
  // Lead gemmes straks (også hvis tilmeldingen aldrig gøres færdig). Samtykket er aktivt (aldrig forudkrydset)
  // og gemmes med den præcise tekst og version, personen så.
  const h = await headers();
  const proof = await currentConsent("marketing");
  const leadId = await upsertLead({
    name: contact.name,
    email: contact.email,
    consent: formData.get("contactConsent") === "on",
    proof: { ...proof, ipAddress: await getClientIp(), userAgent: h.get("user-agent") },
  });
  const s = await getOnboardingSession();
  if (s) {
    await updateOnboardingSession(s.id, { step: Math.max(s.step, 2), data: { ...s.data, contact }, leadId });
  } else {
    await createOnboardingSession({ step: 2, data: { contact }, leadId });
  }
  await prisma.lead.updateMany({ where: { id: leadId, step: { lt: 2 } }, data: { step: 2 } });
  redirect(to(2));
}

/** Trin 2: CVR + telefon. Slår virksomheden op. */
export async function saveCompanyAction(formData: FormData) {
  const s = await need(2);
  const parsed = companyStepSchema.safeParse({ cvr: formData.get("cvr") ?? "", phone: formData.get("phone") ?? "" });
  const keep = `&cvr=${encodeURIComponent(String(formData.get("cvr") ?? ""))}&tlf=${encodeURIComponent(String(formData.get("phone") ?? ""))}`;
  if (!parsed.success) fail(2, parsed.error.issues[0].message, keep);
  const { cvr, phone } = parsed.data!;
  if (!(await rateLimitIp("onb-cvr", await getClientIp(), 20)) || !(await rateLimit(`onb-cvr-s:${s.id}`, 15))) {
    fail(2, "For mange opslag. Vent lidt og prøv igen.", keep);
  }
  const result = await lookupCvr(cvr);
  const company: CompanyState = {
    cvr,
    phone,
    lookup: result.kind,
    confirmed: false,
    ...(result.kind === "ok" || result.kind === "ceased" ? { info: result.company } : {}),
    ...(result.kind === "error" ? { lookupMessage: result.message, quota: result.quota } : {}),
  };
  await updateOnboardingSession(s.id, { step: Math.max(s.step, 3), data: { ...s.data, company } });
  redirect(to(3));
}

/** Trin 3: bekræft virksomheden fra CVR-registret. */
export async function confirmCompanyAction() {
  const s = await need(3);
  const c = s.data.company;
  if (!c || c.lookup !== "ok" || !c.info) redirect(to(3));
  await updateOnboardingSession(s.id, { step: Math.max(s.step, 4), data: { ...s.data, company: { ...c, confirmed: true } } });
  redirect(to(4, "&q=1"));
}

/** Trin 3 (fallback): manuel indtastning, når opslaget fejler. Markeres som ikke verificeret. */
export async function manualCompanyAction(formData: FormData) {
  const s = await need(3);
  const c = s.data.company;
  if (!c || c.lookup === "ok" || c.lookup === "ceased") redirect(to(3));
  const parsed = manualCompanySchema.safeParse({ name: formData.get("name"), address: formData.get("address") });
  if (!parsed.success) fail(3, parsed.error.issues[0].message);
  await updateOnboardingSession(s.id, {
    step: Math.max(s.step, 4),
    data: { ...s.data, company: { ...c, manual: parsed.data, confirmed: true } },
  });
  redirect(to(4, "&q=1"));
}

async function computeSuggestion(state: OnboardingState) {
  const [catalog, questions] = await Promise.all([loadCatalog(), loadActiveQuestions()]);
  const tagIds = new Set(catalog.tags.map((t) => t.id));
  const match = suggestBoard(toMatchAdvisors(catalog.advisors), selectedMatchAnswers(questions, state.answers, tagIds));
  return { ...match, computedAt: new Date().toISOString() };
}

/** Trin 4: gem svar på ét spørgsmål og gå videre. */
export async function answerQuestionAction(formData: FormData) {
  const s = await need(4);
  const questions = await loadActiveQuestions();
  const idx = Math.max(1, Number(formData.get("q")) || 1);
  const q = questions[idx - 1];
  if (!q) redirect(to(5));
  const picked = formData.getAll("answerIds").map(String).filter((id) => q.answers.some((a) => a.id === id));
  const parsed = answerSchema(q.type).safeParse(picked);
  if (!parsed.success) fail(4, parsed.error.issues[0].message, `&q=${idx}`);
  const answers = { ...s.answers, [q.id]: parsed.data! };
  if (idx < questions.length) {
    await updateOnboardingSession(s.id, { answers });
    redirect(to(4, `&q=${idx + 1}`));
  }
  // Sidste spørgsmål: beregn forslag og gå til board-builderen
  const suggested = await computeSuggestion({ ...s, answers });
  await updateOnboardingSession(s.id, {
    step: Math.max(s.step, 5),
    answers,
    suggested,
    data: { ...s.data, board: { advisorIds: suggested.advisorIds, weeks: null } },
  });
  redirect(to(5));
}

/** Trin 4 uden aktive spørgsmål: spring direkte til forslag. */
export async function skipTestAction() {
  const s = await need(4);
  const suggested = await computeSuggestion(s);
  await updateOnboardingSession(s.id, {
    step: Math.max(s.step, 5),
    suggested,
    data: { ...s.data, board: { advisorIds: suggested.advisorIds, weeks: null } },
  });
  redirect(to(5));
}

/** Trin 5: gem valgt board og frekvens. */
export async function saveBoardAction(formData: FormData) {
  const s = await need(5);
  const parsed = boardSchema.safeParse({ advisorIds: [...new Set(formData.getAll("advisorIds").map(String))], weeks: formData.get("weeks") });
  if (!parsed.success) fail(5, parsed.error.issues[0].message);
  const board = await resolveBoard(parsed.data!.advisorIds, parsed.data!.weeks);
  if ("error" in board) fail(5, board.error);
  await updateOnboardingSession(s.id, {
    step: Math.max(s.step, 6),
    data: { ...s.data, board: { advisorIds: parsed.data!.advisorIds, weeks: parsed.data!.weeks } },
  });
  redirect(to(6));
}

/** Trin 6: opret konto og gå til betaling. */
export async function completeOnboardingAction(formData: FormData) {
  const s = await need(6);
  const { contact, company, board: chosen } = s.data;
  if (!contact) redirect(to(1));
  if (!company?.confirmed) redirect(to(3));
  if (!chosen?.weeks) redirect(to(5));
  const parsed = accountSchema.safeParse({
    password: formData.get("password") ?? "",
    confirm: formData.get("confirm") ?? "",
    consent: formData.get("consent") ?? undefined,
    recordingConsent: formData.get("recordingConsent") ?? undefined,
  });
  if (!parsed.success) fail(6, parsed.error.issues[0].message);
  if (!(await rateLimitIp("onb-complete", await getClientIp(), 10))) fail(6, "For mange forsøg. Prøv igen senere.");

  const board = await resolveBoard(chosen.advisorIds, chosen.weeks);
  if ("error" in board) fail(5, board.error);
  const resolved = board as Exclude<typeof board, { error: string }>;
  if (await prisma.user.findUnique({ where: { email: contact.email }, select: { id: true } })) {
    fail(1, "Der findes allerede en konto med den e-mail.", "&konto=1");
  }

  const [questions, tags] = await Promise.all([loadActiveQuestions(), prisma.tag.findMany({ select: { id: true, name: true } })]);
  const suggestion = asSuggestion(s.suggested);
  const snapshot = buildTestSnapshot(
    questions,
    s.answers,
    new Map(tags.map((t) => [t.id, t.name])),
    suggestion,
    resolved.advisors.map((a) => a.id),
  );
  const info = company.info;
  const manual = company.manual;
  const companyName = info?.name ?? manual?.name ?? "";
  const address = info ? [info.address, `${info.zip} ${info.city}`.trim()].filter(Boolean).join(", ") : (manual?.address ?? "");

  const user = await prisma.user.create({
    data: {
      email: contact.email,
      name: contact.name,
      phone: company.phone,
      role: "CUSTOMER",
      passwordHash: await hashPassword(parsed.data!.password),
      consentAt: new Date(),
      ...recordingConsentNow((await currentConsent("recording")).version),
      customerProfile: {
        create: {
          companyName,
          cvr: company.cvr,
          address,
          billingEmail: contact.email,
          cvrVerified: Boolean(info),
          cvrData: (info ?? { manual: true, name: manual?.name, address: manual?.address }) as unknown as Prisma.InputJsonValue,
          testAnswers: snapshot as unknown as Prisma.InputJsonValue,
        },
      },
    },
  });
  await createSession(user.id);
  await convertLead(s.leadId, user.id);
  await audit(user.id, "auth.signup", "User", user.id);

  try {
    const r = await startCheckout({ userId: user.id, board: resolved, cancelPath: "/subscribe" });
    await audit(user.id, "subscription.checkout", "Subscription", r.subscriptionId);
    redirect(r.url);
  } catch (e) {
    if (e instanceof Error && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    console.error("[onboarding] checkout fejlede", e);
    redirect("/subscribe?err=" + encodeURIComponent("Din konto er oprettet, men betalingen kunne ikke startes. Prøv igen."));
  }
}
