import { describe, expect, it } from "vitest";
import { accountSchema, answerSchema, boardSchema, companyStepSchema, contactSchema, manualCompanySchema, normalizePhone } from "./schemas";

describe("contactSchema", () => {
  it("normaliserer e-mail og kræver navn", () => {
    expect(contactSchema.parse({ name: " Anna ", email: " Anna@Firma.DK " })).toEqual({ name: "Anna", email: "anna@firma.dk" });
    expect(contactSchema.safeParse({ name: "A", email: "a@b.dk" }).success).toBe(false);
    expect(contactSchema.safeParse({ name: "Anna", email: "ikke-en-mail" }).success).toBe(false);
  });
});

describe("telefon", () => {
  it("formaterer danske numre", () => {
    expect(normalizePhone("20304050")).toBe("+45 20 30 40 50");
    expect(normalizePhone("+45 20 30 40 50")).toBe("+45 20 30 40 50");
    expect(normalizePhone("0045 20304050")).toBe("+45 20 30 40 50");
  });
  it("accepterer internationale numre", () => {
    expect(normalizePhone("+46 70 123 45 67")).toBe("+46701234567");
    expect(normalizePhone("0044 20 7946 0958")).toBe("+442079460958");
  });
  it("afviser ugyldige", () => {
    expect(normalizePhone("1234")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
});

describe("companyStepSchema", () => {
  it("validerer CVR med modulus 11 og telefon", () => {
    expect(companyStepSchema.parse({ cvr: "3000 0102", phone: "20304050" })).toEqual({ cvr: "30000102", phone: "+45 20 30 40 50" });
    const bad = companyStepSchema.safeParse({ cvr: "12345678", phone: "20304050" });
    expect(bad.success).toBe(false);
    expect(companyStepSchema.safeParse({ cvr: "1234", phone: "20304050" }).success).toBe(false);
    expect(companyStepSchema.safeParse({ cvr: "30000102", phone: "12" }).success).toBe(false);
  });
});

describe("manualCompanySchema", () => {
  it("kræver navn og adresse", () => {
    expect(manualCompanySchema.safeParse({ name: "Firma ApS", address: "Vej 1, 1000 By" }).success).toBe(true);
    expect(manualCompanySchema.safeParse({ name: "", address: "Vej 1" }).success).toBe(false);
  });
});

describe("accountSchema", () => {
  const ok = { password: "LangtPassword1", confirm: "LangtPassword1", consent: "on" };
  it("kræver lang nok adgangskode, ens bekræftelse og samtykke", () => {
    expect(accountSchema.safeParse(ok).success).toBe(true);
    expect(accountSchema.safeParse({ ...ok, password: "kort", confirm: "kort" }).success).toBe(false);
    expect(accountSchema.safeParse({ ...ok, confirm: "andet" }).success).toBe(false);
    expect(accountSchema.safeParse({ ...ok, consent: undefined }).success).toBe(false);
  });
});

describe("boardSchema", () => {
  it("kræver 2-4 rådgivere og en gyldig frekvens", () => {
    expect(boardSchema.safeParse({ advisorIds: ["a", "b"], weeks: "8" }).success).toBe(true);
    expect(boardSchema.safeParse({ advisorIds: ["a"], weeks: "8" }).success).toBe(false);
    expect(boardSchema.safeParse({ advisorIds: ["a", "b", "c", "d", "e"], weeks: "8" }).success).toBe(false);
    expect(boardSchema.safeParse({ advisorIds: ["a", "b"], weeks: "6" }).success).toBe(false);
    expect(boardSchema.safeParse({ advisorIds: ["a", "b"] }).success).toBe(false);
  });
});

describe("answerSchema", () => {
  it("single kræver præcis ét, multi mindst ét", () => {
    expect(answerSchema("SINGLE").safeParse(["a"]).success).toBe(true);
    expect(answerSchema("SINGLE").safeParse(["a", "b"]).success).toBe(false);
    expect(answerSchema("MULTI").safeParse(["a", "b"]).success).toBe(true);
    expect(answerSchema("MULTI").safeParse([]).success).toBe(false);
  });
});
