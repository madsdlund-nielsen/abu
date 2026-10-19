import type { NotificationChannel } from "@prisma/client";
import { prisma } from "./db";
import { getEnv } from "./env";
import { toE164 } from "./phone";

/**
 * Leads og markedsføringssamtykke.
 *
 * Et lead oprettes, så snart onboarding-trin 1 er sendt. Samtykket (e-mail og SMS) gemmes sammen med den præcise tekst,
 * personen så, og versionen af den. Uden samtykke og uden gennemførelse slettes leadet, når tilmeldingen udløber; med samtykke
 * gemmes det, til samtykket trækkes tilbage eller opbevaringsperioden er gået.
 */
export const MARKETING_SOURCE = "onboarding_trin1";

export interface ConsentProof {
  text: string;
  version: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Opretter/opdaterer TILMELDINGENS eget lead og registrerer eller trækker samtykket tilbage efter afkrydsningen.
 * RLS (M-1): kræver en igangværende tilmelding (onboarding-cookien). `rls.capture_onboarding_lead` opretter et nyt lead
 * for tilmeldingen eller opdaterer kun dens eget – et eksisterende lead for samme e-mail (en anden tilmelding, en kunde)
 * røres aldrig, og svaret er det samme (intet orakel). Samtykket skrives derefter af anon selv – politikkerne tillader
 * det kun for eget lead, og tilbagetrækning kun af det samtykke, denne tilmelding selv har givet.
 */
export async function upsertLead(opts: { name: string; email: string; consent: boolean; proof: ConsentProof }): Promise<string> {
  const email = opts.email.trim().toLowerCase();
  const [captured] = await prisma.$queryRaw<{ id: string }[]>`SELECT rls.capture_onboarding_lead(${email}, ${opts.name}) AS id`;
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: captured.id }, select: { id: true, phone: true } });
  const active = await prisma.marketingConsent.findFirst({
    where: { leadId: lead.id, OR: [{ emailConsent: true, emailWithdrawnAt: null }, { smsConsent: true, smsWithdrawnAt: null }] },
  });
  if (opts.consent && !active) {
    await prisma.marketingConsent.create({
      data: {
        leadId: lead.id,
        email,
        phone: lead.phone,
        emailConsent: true,
        smsConsent: true,
        text: opts.proof.text,
        textVersion: opts.proof.version,
        source: MARKETING_SOURCE,
        ipAddress: opts.proof.ipAddress ?? null,
        userAgent: opts.proof.userAgent?.slice(0, 300) ?? null,
      },
    });
  } else if (!opts.consent && active) {
    // Kun samtykker, som denne tilmelding selv har givet (ikke knyttet til en konto) – RLS håndhæver det samme
    const now = new Date();
    await prisma.marketingConsent.updateMany({
      where: { leadId: lead.id, userId: null },
      data: { emailWithdrawnAt: now, smsWithdrawnAt: now },
    });
  }
  return lead.id;
}

/** Kobler leadet til den oprettede konto og gemmer samtykket på kontoen. Uden samtykke fjernes leadet straks. */
export async function convertLead(leadId: string | null, userId: string): Promise<void> {
  if (!leadId) return;
  const consents = await prisma.marketingConsent.count({ where: { leadId } });
  if (consents === 0) {
    await prisma.lead.deleteMany({ where: { id: leadId } });
    return;
  }
  await prisma.lead.update({ where: { id: leadId }, data: { convertedAt: new Date(), userId } });
  await prisma.marketingConsent.updateMany({ where: { leadId }, data: { userId } });
}

export interface MarketingTarget {
  email: string;
  phone?: string | null;
}

/** Findes der et aktivt markedsføringssamtykke til denne kanal (og for SMS: dette telefonnummer)? */
export async function hasMarketingConsent(channel: NotificationChannel, target: MarketingTarget): Promise<boolean> {
  const consents = await prisma.marketingConsent.findMany({
    where: { email: { equals: target.email, mode: "insensitive" } },
  });
  if (channel === "EMAIL") return consents.some((c) => c.emailConsent && !c.emailWithdrawnAt);
  const phone = toE164(target.phone);
  return consents.some((c) => c.smsConsent && !c.smsWithdrawnAt) && phone !== null;
}

/** Trækker markedsføringssamtykke tilbage for en adresse (afmeldingslink, STOP eller Konto). */
export async function withdrawMarketing(channel: NotificationChannel, address: string): Promise<number> {
  const now = new Date();
  if (channel === "EMAIL") {
    const r = await prisma.marketingConsent.updateMany({
      where: { email: { equals: address, mode: "insensitive" }, emailWithdrawnAt: null },
      data: { emailWithdrawnAt: now },
    });
    return r.count;
  }
  const rows = await prisma.marketingConsent.findMany({ where: { smsWithdrawnAt: null, smsConsent: true }, select: { id: true, phone: true, lead: { select: { phone: true } } } });
  const ids = rows.filter((c) => toE164(c.phone ?? c.lead?.phone) === address).map((c) => c.id);
  if (!ids.length) return 0;
  return (await prisma.marketingConsent.updateMany({ where: { id: { in: ids } }, data: { smsWithdrawnAt: now } })).count;
}

export async function withdrawMarketingForUser(userId: string, channels: { email?: boolean; sms?: boolean }): Promise<void> {
  const now = new Date();
  await prisma.marketingConsent.updateMany({ where: { userId, emailWithdrawnAt: null }, data: channels.email ? { emailWithdrawnAt: now } : {} });
  await prisma.marketingConsent.updateMany({ where: { userId, smsWithdrawnAt: null }, data: channels.sms ? { smsWithdrawnAt: now } : {} });
}

export function leadRetentionMonths(setting?: number): number {
  return setting ?? getEnv().LEAD_RETENTION_MONTHS;
}

/**
 * GDPR-oprydning af leads:
 *  - uden aktivt samtykke og ikke gennemført, og tilmeldingen er udløbet → slettes
 *  - gennemført uden samtykke → slettes (kontoen har dataene)
 *  - med samtykke, ikke gennemført: slettes efter opbevaringsperioden (standard 24 mdr. efter seneste aktivitet)
 *  - gennemført med samtykke: leadet slettes efter opbevaringsperioden; samtykket ligger videre på kontoen
 */
export async function cleanupLeads(opts: { retentionMonths: number; now?: Date }): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - opts.retentionMonths);
  const leads = await prisma.lead.findMany({
    include: { consents: true, sessions: { select: { expiresAt: true } } },
  });
  const doomed: string[] = [];
  for (const l of leads) {
    const consented = l.consents.some((c) => (c.emailConsent && !c.emailWithdrawnAt) || (c.smsConsent && !c.smsWithdrawnAt));
    const sessionLive = l.sessions.some((s) => s.expiresAt > now);
    if (l.lastActivityAt < cutoff) doomed.push(l.id);
    else if (!consented && l.convertedAt) doomed.push(l.id);
    else if (!consented && !sessionLive) doomed.push(l.id);
  }
  if (!doomed.length) return 0;
  return (await prisma.lead.deleteMany({ where: { id: { in: doomed } } })).count;
}
