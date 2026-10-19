import { describe, expect, it } from "vitest";
import { advisorOwnProfileSchema, parseAdvisorProfile } from "./advisor-profile";

const ok = { title: "Bestyrelsesformand", bio: "Erfaren leder.", phone: "" };

describe("rådgiverprofil: samme validering for admin og rådgiver", () => {
  it("godtager gyldige felter og normaliserer telefonnummeret", () => {
    expect(parseAdvisorProfile({ ...ok, phone: "20 30 40 50" })).toEqual({
      ok: true,
      data: { title: "Bestyrelsesformand", bio: "Erfaren leder.", phone: "+45 20 30 40 50" },
    });
    expect(parseAdvisorProfile({ ...ok, title: "  Titel  " })).toMatchObject({ ok: true, data: { title: "Titel", phone: null } });
  });

  it("der er ingen foto-URL længere: et gammelt felt ignoreres og gemmes aldrig", () => {
    const r = parseAdvisorProfile({ ...ok, photoUrl: "https://tracker.example.com/pixel.jpg" });
    expect(r).toEqual({ ok: true, data: { title: "Bestyrelsesformand", bio: "Erfaren leder.", phone: null } });
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
