import { describe, expect, it } from "vitest";
import { mapCvrapi, parseCvrapiDate } from "./cvrapi";
import { MOCK_COMPANIES, MOCK_NOT_FOUND_CVR, MockCvr } from "./mock";
import { isValidCvr, normalizeCvr } from "./validate";
import { mapVirkSource } from "./virk";

describe("CVR modulus 11", () => {
  it("accepterer gyldige numre", () => {
    expect(isValidCvr("30000102")).toBe(true);
    expect(isValidCvr("30 00 01 02")).toBe(true);
    expect(isValidCvr("DK30000102")).toBe(true);
  });
  it("afviser forkert kontrolsum, længde og bogstaver", () => {
    expect(isValidCvr("12345678")).toBe(false);
    expect(isValidCvr("3000010")).toBe(false);
    expect(isValidCvr("300001022")).toBe(false);
    expect(isValidCvr("3000010a")).toBe(false);
    expect(isValidCvr("")).toBe(false);
  });
  it("normaliserer", () => expect(normalizeCvr(" dk-3000 0102 ")).toBe("30000102"));
  it("alle mock-numre er gyldige", () => {
    for (const k of [...Object.keys(MOCK_COMPANIES), MOCK_NOT_FOUND_CVR]) expect(isValidCvr(k)).toBe(true);
  });
});

describe("MockCvr", () => {
  const mock = new MockCvr();
  it("finder en kendt virksomhed", async () => {
    const r = await mock.lookup("30000102");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.company.name).toBe("Nordlys Consulting ApS");
  });
  it("giver ophørt og ikke fundet", async () => {
    expect((await mock.lookup("34000107")).kind).toBe("ceased");
    expect((await mock.lookup(MOCK_NOT_FOUND_CVR)).kind).toBe("not_found");
  });
  it("giver en deterministisk fallback for andre gyldige CVR", async () => {
    const a = await mock.lookup("36000104");
    const b = await mock.lookup("36000104");
    expect(a).toEqual(b);
    expect(a.kind).toBe("ok");
  });
});

describe("adaptere (feltmapping)", () => {
  it("mapper cvrapi.dk-svar", () => {
    const c = mapCvrapi("30000102", {
      name: "Test ApS", address: "Vej 1", zipcode: 1000, city: "København K", companydesc: "Anpartsselskab",
      industrycode: 702200, industrydesc: "Rådgivning", startdate: "01/03 - 2016", employees: "10-19", enddate: null,
    });
    expect(c).toMatchObject({ name: "Test ApS", zip: "1000", startDate: "2016-03-01", employees: "10-19", active: true, industryCode: "702200" });
    expect(mapCvrapi("1", { enddate: "01/01 - 2020" }).active).toBe(false);
    expect(parseCvrapiDate("5/11 - 2019")).toBe("2019-11-05");
  });
  it("mapper virk-svar", () => {
    const c = mapVirkSource("30000102", {
      virksomhedMetadata: {
        nyesteNavn: { navn: "Test ApS" },
        nyesteBeliggenhedsadresse: { vejnavn: "Nyhavn", husnummerFra: 12, postnummer: 1051, postdistrikt: "København K" },
        nyesteVirksomhedsform: { langBeskrivelse: "Anpartsselskab" },
        nyesteHovedbranche: { branchekode: "702200", branchetekst: "Rådgivning" },
        nyesteAarsbeskaeftigelse: { intervalKodeAntalAnsatte: "ANTAL_10_19" },
        stiftelsesDato: "2016-03-01",
        sammensatStatus: "NORMAL",
      },
    });
    expect(c).toMatchObject({ name: "Test ApS", address: "Nyhavn 12", zip: "1051", employees: "10-19", active: true, startDate: "2016-03-01" });
  });
});
