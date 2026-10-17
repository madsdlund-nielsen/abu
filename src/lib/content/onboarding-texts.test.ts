import { describe, expect, it } from "vitest";
import { DEFAULTS, interpolate, parseRich, resolveTexts, TEXT_BY_KEY, TEXT_DEFS, validateText, consentVersion } from "./onboarding-texts";

describe("tekstdefinitioner", () => {
  it("har unikke nøgler og en gyldig standardtekst til hver", () => {
    expect(new Set(TEXT_DEFS.map((d) => d.key)).size).toBe(TEXT_DEFS.length);
    for (const d of TEXT_DEFS) {
      expect(d.default.trim().length, d.key).toBeGreaterThan(0);
      expect(validateText(d, d.default), d.key).toBeNull();
    }
  });
  it("dækker alle seks trin og de fælles tekster", () => {
    expect(new Set(TEXT_DEFS.map((d) => d.step))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
  });
  it("markerer begge samtykketekster", () => {
    expect(TEXT_DEFS.filter((d) => d.consent).map((d) => d.key).sort()).toEqual(["step1.consent", "step6.recordingConsent"]);
  });
});

describe("resolveTexts", () => {
  it("falder tilbage til standard for manglende, tomme og ukendte nøgler", () => {
    const t = resolveTexts({ "step1.title": "Velkommen", "step2.title": "   ", "findes.ikke": "x" });
    expect(t["step1.title"]).toBe("Velkommen");
    expect(t["step2.title"]).toBe(DEFAULTS["step2.title"]);
    expect(t["step3.title"]).toBe(DEFAULTS["step3.title"]);
    expect("findes.ikke" in t).toBe(false);
  });
  it("giver alle nøgler uden ændringer", () => {
    expect(resolveTexts({})).toEqual(DEFAULTS);
  });
});

describe("interpolate", () => {
  it("udfylder pladsholdere og lader ukendte stå", () => {
    expect(interpolate("Trin {n} af {total}", { n: 2, total: 6 })).toBe("Trin 2 af 6");
    expect(interpolate("Hej {navn}", {})).toBe("Hej {navn}");
  });
});

describe("validateText", () => {
  const def = TEXT_BY_KEY["step3.ceasedBody"];
  it("afviser ukendte pladsholdere og for lange tekster", () => {
    expect(validateText(def, "CVR {cvr} er {fejl}")).toMatch(/Ukendt pladsholder/);
    expect(validateText(def, "x".repeat(401))).toMatch(/for lang/);
    expect(validateText(def, "CVR {cvr} ({navn}) er {status}")).toBeNull();
  });
  it("afviser usikre links og tillader tom (gendan standard)", () => {
    const d = TEXT_BY_KEY["step1.loginHint"];
    expect(validateText(d, "[x](javascript:alert(1))")).toMatch(/Ugyldigt link/);
    expect(validateText(d, "[Log ind](/login)")).toBeNull();
    expect(validateText(d, "")).toBeNull();
  });
  it("tillader ikke linjeskift i enkeltlinjetekster", () => {
    expect(validateText(TEXT_BY_KEY["step1.title"], "a\nb")).toMatch(/linjeskift/);
  });
});

describe("parseRich", () => {
  it("fortolker fed og links", () => {
    expect(parseRich("Se **vigtigt** og [vilkår](/vilkaar).")).toEqual([
      { type: "text", text: "Se " },
      { type: "bold", text: "vigtigt" },
      { type: "text", text: " og " },
      { type: "link", text: "vilkår", href: "/vilkaar" },
      { type: "text", text: "." },
    ]);
  });
  it("viser usikre links som ren tekst", () => {
    expect(parseRich("[klik](javascript:x)")).toEqual([{ type: "text", text: "klik" }]);
  });
});

describe("consentVersion", () => {
  it("er 0 for standardteksten og hæves ved ændring", () => {
    expect(consentVersion("m", null)).toBe("m0");
    expect(consentVersion("m", { version: 3 })).toBe("m3");
  });
});
