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

export async function loadLeads(filter: LeadFilter, now = new Date()): Promise<LeadRow[]> {
  const leads = await prisma.lead.findMany({
    include: { consents: { orderBy: { consentedAt: "desc" } }, sessions: { select: { expiresAt: true } } },
    orderBy: { lastActivityAt: "desc" },
    take: 2000,
  });
  const rows = leads.map((l): LeadRow => {
    const active = l.consents.filter((c) => (c.emailConsent && !c.emailWithdrawnAt) || (c.smsConsent && !c.smsWithdrawnAt));
    const channels = [
      active.some((c) => c.emailConsent && !c.emailWithdrawnAt) ? "E-mail" : "",
      active.some((c) => c.smsConsent && !c.smsWithdrawnAt) && toE164(l.phone) ? "SMS" : "",
    ].filter(Boolean);
    const latest = l.consents[0];
    return {
      id: l.id,
      name: l.name,
      email: l.email,
      phone: l.phone,
      step: l.step,
      createdAt: l.createdAt,
      lastActivityAt: l.lastActivityAt,
      status: l.convertedAt ? "gennemfoert" : l.sessions.some((s) => s.expiresAt > now) ? "igang" : "udloebet",
      consent: active.length ? "ja" : latest ? "trukket" : "nej",
      channels: active.length ? (channels.length ? channels : ["E-mail"]) : [],
      consentedAt: latest?.consentedAt ?? null,
      consentVersion: latest?.textVersion ?? null,
    };
  });
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
  const header = ["Navn", "E-mail", "Telefon", "Trin nået", "Status", "Samtykke", "Kanaler", "Samtykke givet", "Samtykke-version", "Oprettet", "Seneste aktivitet"];
  const lines = rows.map((r) =>
    [r.name, r.email, r.phone ?? "", r.step, STATUS_LABEL[r.status], CONSENT_LABEL[r.consent], r.channels.join(" + "), iso(r.consentedAt), r.consentVersion ?? "", iso(r.createdAt), iso(r.lastActivityAt)]
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
