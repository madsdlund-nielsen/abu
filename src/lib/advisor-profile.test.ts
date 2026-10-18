import { describe, expect, it } from "vitest";
import { advisorOwnProfileSchema, parseAdvisorProfile } from "./advisor-profile";

const ok = { title: "Bestyrelsesformand", bio: "Erfaren leder.", phone: "", photoUrl: "" };

describe("rådgiverprofil: samme validering for admin og rådgiver", () => {
  it("godtager gyldige felter og normaliserer telefonnummeret", () => {
    expect(parseAdvisorProfile({ ...ok, phone: "20 30 40 50", photoUrl: "https://example.dk/foto.jpg" })).toEqual({
      ok: true,
      data: { title: "Bestyrelsesformand", bio: "Erfaren leder.", phone: "+45 20 30 40 50", photoUrl: "https://example.dk/foto.jpg" },
    });
    expect(parseAdvisorProfile({ ...ok, title: "  Titel  " })).toMatchObject({ ok: true, data: { title: "Titel", phone: null } });
  });

  it("foto-URL skal være https", () => {
    expect(parseAdvisorProfile({ ...ok, photoUrl: "http://example.dk/foto.jpg" })).toEqual({ ok: false, error: "Foto-URL skal starte med https://" });
    expect(parseAdvisorProfile({ ...ok, photoUrl: "javascript:alert(1)" })).toEqual({ ok: false, error: "Foto-URL skal starte med https://" });
    expect(parseAdvisorProfile({ ...ok, photoUrl: `https://x.dk/${"a".repeat(500)}` })).toMatchObject({ ok: false });
  });

  it("længdegrænser og ugyldigt telefonnummer", () => {
    expect(parseAdvisorProfile({ ...ok, title: "x".repeat(121) })).toEqual({ ok: false, error: "Titlen må højst være 120 tegn." });
    expect(parseAdvisorProfile({ ...ok, bio: "x".repeat(4001) })).toEqual({ ok: false, error: "Præsentationen må højst være 4.000 tegn." });
    expect(parseAdvisorProfile({ ...ok, phone: "123" })).toEqual({ ok: false, error: expect.stringMatching(/gyldigt telefonnummer/) });
  });

  it("rådgiverens egen formular kræver også navn", () => {
    expect(advisorOwnProfileSchema.safeParse({ ...ok, name: "A" }).success).toBe(false);
    expect(advisorOwnProfileSchema.safeParse({ ...ok, name: "Anna" }).success).toBe(true);
  });
});
