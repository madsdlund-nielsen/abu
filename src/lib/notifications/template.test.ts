import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, DEFAULT_TEMPLATES } from "./defaults";
import { extractVariables, renderTemplate, smsSegments, validateTemplate } from "./template";
import { TRIGGERS, VARIABLES, KNOWN_VARIABLES } from "./triggers";
import { describeChange, joinNames, meetingDateVars } from "./variables";

describe("extractVariables / renderTemplate", () => {
  it("finder variabler med danske tegn og mellemrum", () => {
    expect(extractVariables("Hej {{fornavn}} {{ rådgivere }} {{mødelink}} {{fornavn}}")).toEqual(["fornavn", "rådgivere", "mødelink"]);
  });
  it("udfylder variabler, og manglende bliver tomme", () => {
    expect(renderTemplate("Hej {{fornavn}} kl. {{mødetid}}{{findes_ikke}}", { fornavn: "Mette", mødetid: "10:00" })).toBe("Hej Mette kl. 10:00");
  });
});

describe("validateTemplate", () => {
  it("accepterer en gyldig e-mail", () => {
    expect(validateTemplate({ channel: "EMAIL", name: "Test", subject: "Emne {{fornavn}}", body: "Hej {{fornavn}}" })).toEqual([]);
  });
  it("giver fejl for ukendte variabler i tekst og emne", () => {
    const i = validateTemplate({ channel: "EMAIL", subject: "Hej {{navnet}}", body: "Hej {{fornavnn}} og {{fornavn}}" });
    expect(i.map((x) => x.field).sort()).toEqual(["body", "subject"]);
    expect(i.find((x) => x.field === "body")?.variables).toEqual(["fornavnn"]);
    expect(i.find((x) => x.field === "body")?.message).toMatch(/\{\{fornavnn\}\}/);
  });
  it("kræver emne til e-mail men ikke SMS, og afviser tom tekst", () => {
    expect(validateTemplate({ channel: "EMAIL", subject: " ", body: "x" }).some((i) => i.field === "subject")).toBe(true);
    expect(validateTemplate({ channel: "SMS", body: "ABU: hej" })).toEqual([]);
    expect(validateTemplate({ channel: "SMS", body: "  " }).some((i) => i.field === "body")).toBe(true);
  });
  it("opdager ufuldstændige tuborgklammer", () => {
    expect(validateTemplate({ channel: "SMS", body: "Hej {{fornavn" }).some((i) => /ufuldstændig/.test(i.message))).toBe(true);
  });
  it("begrænser variabler til en udløsers sæt", () => {
    const body = "Se {{ændring}}";
    expect(validateTemplate({ channel: "SMS", body }, TRIGGERS.meeting_booked.variables).length).toBe(1);
    expect(validateTemplate({ channel: "SMS", body }, TRIGGERS.meeting_participant_changed.variables)).toEqual([]);
  });
  it("afviser SMS med alt for mange dele", () => {
    expect(validateTemplate({ channel: "SMS", body: "x".repeat(1100) }).some((i) => /dele/.test(i.message))).toBe(true);
  });
});

describe("smsSegments", () => {
  it("tæller æøå som GSM-7: 160 tegn er én SMS", () => {
    const s = smsSegments("æøåÆØÅ".repeat(30).slice(0, 160));
    expect(s).toMatchObject({ encoding: "GSM-7", length: 160, segments: 1, remaining: 0 });
  });
  it("161 GSM-7-tegn bliver to dele à 153", () => {
    const s = smsSegments("a".repeat(161));
    expect(s).toMatchObject({ encoding: "GSM-7", segments: 2, perSegment: 153, remaining: 2 * 153 - 161 });
    expect(smsSegments("a".repeat(306)).segments).toBe(2);
    expect(smsSegments("a".repeat(307)).segments).toBe(3);
  });
  it("udvidede GSM-tegn (€, [, ~) fylder to", () => {
    expect(smsSegments("€").length).toBe(2);
    expect(smsSegments("a".repeat(159) + "€").segments).toBe(2);
  });
  it("tegn uden for GSM-7 (emoji, «») giver UCS-2 med 70/67", () => {
    expect(smsSegments("Hej 😀")).toMatchObject({ encoding: "UCS-2", length: 6, segments: 1, perSegment: 70 });
    expect(smsSegments("«" + "a".repeat(70)).segments).toBe(2);
    expect(smsSegments("«" + "a".repeat(133)).segments).toBe(2); // 134 = 2 x 67
    expect(smsSegments("«" + "a".repeat(134)).segments).toBe(3);
  });
  it("tom tekst er 0 dele", () => expect(smsSegments("").segments).toBe(0));
});

describe("standardtekster", () => {
  it("er gyldige og bruger kun variabler, som deres udløsere har", () => {
    const byKey = new Map(DEFAULT_TEMPLATES.map((t) => [t.key, t]));
    expect(byKey.size).toBe(DEFAULT_TEMPLATES.length);
    for (const t of DEFAULT_TEMPLATES) expect(validateTemplate({ channel: t.channel, name: t.name, subject: t.subject, body: t.body }), t.key).toEqual([]);
    for (const r of DEFAULT_RULES) {
      const t = byKey.get(r.templateKey)!;
      expect(t, r.templateKey).toBeDefined();
      expect(t.channel).toBe(r.channel);
      expect(validateTemplate({ channel: t.channel, subject: t.subject, body: t.body }, TRIGGERS[r.trigger].variables), `${r.trigger} ${r.templateKey}`).toEqual([]);
      expect(TRIGGERS[r.trigger].audiences).toContain(r.audience);
    }
  });
  it("dækker alle udløsere, og de låste har en e-mail-regel", () => {
    for (const k of Object.keys(TRIGGERS)) expect(DEFAULT_RULES.some((r) => r.trigger === k), k).toBe(true);
    for (const t of Object.values(TRIGGERS).filter((x) => x.locked)) expect(DEFAULT_RULES.some((r) => r.trigger === t.key && r.channel === "EMAIL")).toBe(true);
  });
  it("standard-SMS'erne fylder én SMS med eksempeldata", () => {
    const sample = Object.fromEntries(Object.entries(VARIABLES).map(([k, v]) => [k, v.sample.replace("{APP}", "https://abu.example.dk")]));
    for (const t of DEFAULT_TEMPLATES.filter((x) => x.channel === "SMS")) expect(smsSegments(renderTemplate(t.body, sample)).segments, t.key).toBe(1);
  });
  it("alle kendte variabler har en eksempelværdi", () => {
    for (const v of KNOWN_VARIABLES) expect(VARIABLES[v].sample.length).toBeGreaterThan(0);
  });
});

describe("variabler til beskeder", () => {
  it("joinNames på dansk", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A og B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B og C");
  });
  it("mødedato og tid i København-tid", () => {
    expect(meetingDateVars(new Date("2026-11-12T09:00:00Z"))).toEqual({ mødedato: "torsdag 12. november 2026", mødedato_kort: "tor. 12. nov.", mødetid: "10:00" });
    expect(meetingDateVars(new Date("2026-06-18T08:00:00Z")).mødetid).toBe("10:00");
  });
  it("describeChange tilpasser teksten til modtageren", () => {
    const base = { scope: "meeting" as const, added: ["Camilla"], removed: ["Jesper"] };
    expect(describeChange({ ...base, role: "customer" })).toBe("Jesper er udgået af mødet, og Camilla deltager i stedet.");
    expect(describeChange({ ...base, role: "added" })).toBe("Du er tilføjet som rådgiver til mødet, i stedet for Jesper.");
    expect(describeChange({ ...base, role: "removed" })).toBe("Du er udgået af mødet, og Camilla deltager i stedet.");
    expect(describeChange({ scope: "meeting", role: "customer", added: ["Camilla"], removed: [] })).toBe("Camilla er tilføjet som deltager.");
    expect(describeChange({ scope: "board", role: "customer", added: ["A"], removed: ["B"], upcomingUpdated: 2 })).toMatch(/2 kommende møder er opdateret/);
  });
});
