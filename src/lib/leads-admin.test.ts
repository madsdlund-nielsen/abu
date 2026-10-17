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
  ...over,
});

describe("leadsToCsv", () => {
  it("laver CSV med BOM, semikolon og danske overskrifter", () => {
    const csv = leadsToCsv([row()]);
    expect(csv.startsWith("﻿Navn;E-mail;Telefon;")).toBe(true);
    expect(csv).toContain("Mette Lindberg;mette@firma.dk;+45 20 30 40 50;3;I gang;Samtykke;E-mail + SMS;2026-11-01T10:00:00.000Z;m0");
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
