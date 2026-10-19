import { describe, expect, it } from "vitest";
import { leadsToCsv, parseLeadFilter, type LeadRow } from "./leads-admin";

const row = (over: Partial<LeadRow> = {}): LeadRow => ({
  id: "1",
  name: "Mette Lindberg",
  email: "mette@firma.dk",
  phone: "+45 20 30 40 50",
  step: 3,
  createdAt: new Date("2026-11-01T10:00:00Z"),
  lastActivityAt: new Date("2026-11-02T10:00:00Z"),
  status: "igang",
  consent: "ja",
  channels: ["E-mail", "SMS"],
  consentedAt: new Date("2026-11-01T10:00:00Z"),
  consentVersion: "m0",
  attempts: 1,
  ...over,
});

describe("leadsToCsv", () => {
  it("laver CSV med BOM, semikolon og danske overskrifter", () => {
    const csv = leadsToCsv([row()]);
    expect(csv.startsWith("﻿Navn;E-mail;Telefon;")).toBe(true);
    expect(csv).toContain("Mette Lindberg;mette@firma.dk;+45 20 30 40 50;3;I gang;Samtykke;E-mail + SMS;2026-11-01T10:00:00.000Z;m0");
    expect(csv.split("\r\n")[0].endsWith(";Tilmeldinger")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
  it("citerer felter med semikolon/citationstegn og neutraliserer formler", () => {
    const csv = leadsToCsv([row({ name: 'A; "B"', email: "=cmd|x@y.dk" })]);
    expect(csv).toContain('"A; ""B"""');
    expect(csv).toContain("'=cmd|x@y.dk");
  });
});

describe("parseLeadFilter", () => {
  it("accepterer kun kendte værdier", () => {
    expect(parseLeadFilter({ status: "igang", samtykke: "ja", q: " mette " })).toEqual({ status: "igang", consent: "ja", q: "mette" });
    expect(parseLeadFilter({ status: "hack", samtykke: ["trukket"] })).toEqual({ status: "", consent: "trukket", q: "" });
  });
});

describe("læsbar samtykkeversion (plan #25)", () => {
  it("viser standardtekst eller versionsnummer i stedet for m0/m3", async () => {
    const { consentVersionLabel } = await import("./leads-admin");
    expect(consentVersionLabel("m0")).toBe("standardtekst");
    expect(consentVersionLabel("m3")).toBe("version 3");
    expect(consentVersionLabel(null)).toBe("");
  });
});

describe("groupLeadsByEmail (M-1: ét lead pr. tilmelding, én række pr. e-mail)", () => {
  const now = new Date("2026-11-10T10:00:00Z");
  const lead = (over: Record<string, unknown>) => ({
    id: "l",
    name: "N",
    email: "a@b.dk",
    phone: null as string | null,
    step: 1,
    createdAt: new Date("2026-11-01T10:00:00Z"),
    lastActivityAt: new Date("2026-11-01T10:00:00Z"),
    convertedAt: null as Date | null,
    consents: [] as { emailConsent: boolean; smsConsent: boolean; emailWithdrawnAt: Date | null; smsWithdrawnAt: Date | null; consentedAt: Date; textVersion: string }[],
    sessions: [] as { expiresAt: Date }[],
    ...over,
  });
  it("samler leads med samme e-mail (uanset store/små bogstaver) og foretrækker det gennemførte", async () => {
    const { groupLeadsByEmail } = await import("./leads-admin");
    const consent = { emailConsent: true, smsConsent: false, emailWithdrawnAt: null, smsWithdrawnAt: null, consentedAt: new Date("2026-11-02T10:00:00Z"), textVersion: "m1" };
    const rows = groupLeadsByEmail(
      [
        lead({ id: "victim", name: "Rigtig Person", email: "Person@Firma.dk", phone: "+4520304050", step: 3, consents: [consent], convertedAt: new Date("2026-11-03T10:00:00Z") }),
        lead({ id: "other", name: "Anden Indtastning", email: "person@firma.dk", step: 1, lastActivityAt: new Date("2026-11-09T10:00:00Z"), sessions: [{ expiresAt: new Date("2026-11-12T10:00:00Z") }] }),
        lead({ id: "solo", email: "solo@firma.dk", step: 2, lastActivityAt: new Date("2026-11-05T10:00:00Z") }),
      ],
      now,
    );
    expect(rows.map((r) => [r.id, r.attempts])).toEqual([["victim", 2], ["solo", 1]]);
    const p = rows[0];
    expect(p).toMatchObject({ name: "Rigtig Person", step: 3, status: "gennemfoert", consent: "ja", channels: ["E-mail"], phone: "+4520304050" });
    expect(p.lastActivityAt.toISOString()).toBe("2026-11-09T10:00:00.000Z");
    expect(rows[1]).toMatchObject({ status: "udloebet", consent: "nej" });
  });
});
