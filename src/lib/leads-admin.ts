import { prisma } from "./db";
import { toE164 } from "./phone";

export type LeadStatus = "igang" | "gennemfoert" | "udloebet";
export type LeadConsent = "ja" | "trukket" | "nej";

export interface LeadRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  step: number;
  createdAt: Date;
  lastActivityAt: Date;
  status: LeadStatus;
  consent: LeadConsent;
  /** Hvilke kanaler samtykket gælder lige nu */
  channels: string[];
  consentedAt: Date | null;
  consentVersion: string | null;
  /** Antal tilmeldinger (leads) med denne e-mail – hver tilmelding har sit eget lead (M-1) */
  attempts: number;
}

export interface LeadFilter {
  status?: LeadStatus | "";
  consent?: LeadConsent | "";
  q?: string;
}

export const STATUS_LABEL: Record<LeadStatus, string> = { igang: "I gang", gennemfoert: "Gennemført", udloebet: "Udløbet" };
export const CONSENT_LABEL: Record<LeadConsent, string> = { ja: "Samtykke", trukket: "Trukket tilbage", nej: "Intet samtykke" };

export function parseLeadFilter(p: Record<string, string | string[] | undefined>): LeadFilter {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = one(p.status);
  const consent = one(p.samtykke);
  return {
    status: status === "igang" || status === "gennemfoert" || status === "udloebet" ? status : "",
    consent: consent === "ja" || consent === "trukket" || consent === "nej" ? consent : "",
    q: one(p.q).trim(),
  };
}

type LeadWithRelations = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  step: number;
  createdAt: Date;
  lastActivityAt: Date;
  convertedAt: Date | null;
  consents: { emailConsent: boolean; smsConsent: boolean; emailWithdrawnAt: Date | null; smsWithdrawnAt: Date | null; consentedAt: Date; textVersion: string }[];
  sessions: { expiresAt: Date }[];
};

const isActive = (c: LeadWithRelations["consents"][number]) => (c.emailConsent && !c.emailWithdrawnAt) || (c.smsConsent && !c.smsWithdrawnAt);

/**
 * Én række pr. e-mail (M-1: hver tilmelding har sit eget lead, så samme person kan have flere). Navn og telefon kommer
 * fra det gennemførte lead, ellers det lead, der først gav et (stadig aktivt) samtykke, ellers det seneste – så en senere
 * tilmelding med samme e-mail ikke «overtager» visningen. Trin er det højeste; samtykket gælder e-mailen (som afsendelse
 * og afmelding), dvs. aktivt hvis et af leadene har et aktivt samtykke. Ren funktion.
 */
export function groupLeadsByEmail(leads: LeadWithRelations[], now = new Date()): LeadRow[] {
  const groups = new Map<string, LeadWithRelations[]>();
  for (const l of leads) {
    const key = l.email.trim().toLowerCase();
    const g = groups.get(key);
    if (g) g.push(l);
    else groups.set(key, [l]);
  }
  const rows = [...groups.values()].map((g): LeadRow => {
    const byActivity = [...g].sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
    const firstConsent = (l: LeadWithRelations) => Math.min(...l.consents.filter(isActive).map((c) => c.consentedAt.getTime()));
    const consenting = g.filter((l) => l.consents.some(isActive)).sort((a, b) => firstConsent(a) - firstConsent(b));
    const primary = byActivity.find((l) => l.convertedAt) ?? consenting[0] ?? byActivity[0];
    const consents = g.flatMap((l) => l.consents).sort((a, b) => b.consentedAt.getTime() - a.consentedAt.getTime());
    const active = consents.filter(isActive);
    const phone = primary.phone ?? byActivity.find((l) => l.phone)?.phone ?? null;
    const channels = [
      active.some((c) => c.emailConsent && !c.emailWithdrawnAt) ? "E-mail" : "",
      active.some((c) => c.smsConsent && !c.smsWithdrawnAt) && toE164(phone) ? "SMS" : "",
    ].filter(Boolean);
    const latest = consents[0];
    return {
      id: primary.id,
      name: primary.name,
      email: primary.email,
      phone,
      step: Math.max(...g.map((l) => l.step)),
      createdAt: new Date(Math.min(...g.map((l) => l.createdAt.getTime()))),
      lastActivityAt: byActivity[0].lastActivityAt,
      status: g.some((l) => l.convertedAt) ? "gennemfoert" : g.some((l) => l.sessions.some((s) => s.expiresAt > now)) ? "igang" : "udloebet",
      consent: active.length ? "ja" : latest ? "trukket" : "nej",
      channels: active.length ? (channels.length ? channels : ["E-mail"]) : [],
      consentedAt: latest?.consentedAt ?? null,
      consentVersion: latest?.textVersion ?? null,
      attempts: g.length,
    };
  });
  return rows.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
}

export async function loadLeads(filter: LeadFilter, now = new Date()): Promise<LeadRow[]> {
  const leads = await prisma.lead.findMany({
    include: { consents: { orderBy: { consentedAt: "desc" } }, sessions: { select: { expiresAt: true } } },
    orderBy: { lastActivityAt: "desc" },
    take: 5000,
  });
  const rows = groupLeadsByEmail(leads, now);
  const q = filter.q?.toLowerCase();
  return rows.filter(
    (r) =>
      (!filter.status || r.status === filter.status) &&
      (!filter.consent || r.consent === filter.consent) &&
      (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)),
  );
}

/** CSV med semikolon og BOM (åbner korrekt i dansk Excel). Celler, der kunne tolkes som formler, escapes. */
export function leadsToCsv(rows: LeadRow[]): string {
  const cell = (v: string | number) => {
    let s = String(v);
    // Formel-injektion i regneark: telefonnumre som +45 20 30 40 50 er ufarlige og bevares
    if (/^[=@\t\r]/.test(s) || (/^[+\-]/.test(s) && !/^\+[\d ]+$/.test(s))) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const iso = (d: Date | null) => (d ? d.toISOString() : "");
  const header = ["Navn", "E-mail", "Telefon", "Trin nået", "Status", "Samtykke", "Kanaler", "Samtykke givet", "Samtykke-version", "Oprettet", "Seneste aktivitet", "Tilmeldinger"];
  const lines = rows.map((r) =>
    [r.name, r.email, r.phone ?? "", r.step, STATUS_LABEL[r.status], CONSENT_LABEL[r.consent], r.channels.join(" + "), iso(r.consentedAt), r.consentVersion ?? "", iso(r.createdAt), iso(r.lastActivityAt), r.attempts]
      .map(cell)
      .join(";"),
  );
  return "﻿" + [header.map(cell).join(";"), ...lines].join("\r\n") + "\r\n";
}

/** Læsbar samtykkeversion: "m0" → "standardtekst", "m3" → "version 3" (QA plan #25). */
export function consentVersionLabel(v: string | null | undefined): string {
  const m = /^[a-z](\d+)$/.exec(v ?? "");
  if (!m) return v ?? "";
  return m[1] === "0" ? "standardtekst" : `version ${m[1]}`;
}
