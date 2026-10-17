import type { CompanyInfo, CvrLookupResult, CvrProvider } from "./types";

/** Fiktive demo-virksomheder med gyldige CVR-numre (modulus 11). */
export const MOCK_COMPANIES: Record<string, CompanyInfo> = {
  "30000102": {
    cvr: "30000102",
    name: "Nordlys Consulting ApS",
    address: "Nyhavn 12, 3. th.",
    zip: "1051",
    city: "København K",
    companyForm: "Anpartsselskab",
    industryCode: "702200",
    industryText: "Virksomhedsrådgivning og anden rådgivning om driftsledelse",
    startDate: "2016-03-01",
    employees: "10-19",
    active: true,
    statusText: "Normal",
  },
  "31000106": {
    cvr: "31000106",
    name: "Havneby Bryggeri A/S",
    address: "Skibsbroen 4",
    zip: "8000",
    city: "Aarhus C",
    companyForm: "Aktieselskab",
    industryCode: "110500",
    industryText: "Fremstilling af øl",
    startDate: "2009-09-15",
    employees: "50-99",
    active: true,
    statusText: "Normal",
  },
  "32000118": {
    cvr: "32000118",
    name: "Fjordtek Solutions ApS",
    address: "Fabriksvej 21",
    zip: "5000",
    city: "Odense C",
    companyForm: "Anpartsselskab",
    industryCode: "620100",
    industryText: "Computerprogrammering",
    startDate: "2020-01-02",
    employees: "5-9",
    active: true,
    statusText: "Normal",
  },
  "34000107": {
    cvr: "34000107",
    name: "Gamle Smedje ApS",
    address: "Smedegade 3",
    zip: "7100",
    city: "Vejle",
    companyForm: "Anpartsselskab",
    industryCode: "251100",
    industryText: "Fremstilling af metalkonstruktioner",
    startDate: "2004-06-01",
    employees: null,
    active: false,
    statusText: "Opløst efter konkurs",
  },
};
/** Gyldigt CVR, der ikke findes i mock-registret. */
export const MOCK_NOT_FOUND_CVR = "35000100";

const FORMS = ["Anpartsselskab", "Aktieselskab", "Enkeltmandsvirksomhed"];
const STREETS = ["Industrivej", "Strandvejen", "Søndergade", "Algade", "Parkvej"];
const CITIES: [string, string][] = [["2100", "København Ø"], ["8200", "Aarhus N"], ["9000", "Aalborg"], ["5000", "Odense C"], ["6700", "Esbjerg"]];
const EMPLOYEES = ["1-4", "5-9", "10-19", "20-49", "50-99"];

/** Deterministisk demo-virksomhed for ethvert andet gyldigt CVR. */
function fallback(cvr: string): CompanyInfo {
  const n = Number(cvr);
  const [zip, city] = CITIES[n % CITIES.length];
  const form = FORMS[n % FORMS.length];
  const suffix = form === "Aktieselskab" ? "A/S" : form === "Anpartsselskab" ? "ApS" : "";
  return {
    cvr,
    name: `Demovirksomhed ${cvr}${suffix ? " " + suffix : ""}`,
    address: `${STREETS[n % STREETS.length]} ${(n % 90) + 1}`,
    zip,
    city,
    companyForm: form,
    industryCode: "702200",
    industryText: "Virksomhedsrådgivning og anden rådgivning om driftsledelse",
    startDate: `${2005 + (n % 18)}-0${(n % 9) + 1}-01`,
    employees: EMPLOYEES[n % EMPLOYEES.length],
    active: true,
    statusText: "Normal",
  };
}

export class MockCvr implements CvrProvider {
  readonly name = "mock" as const;
  async lookup(cvr: string): Promise<CvrLookupResult> {
    if (cvr === MOCK_NOT_FOUND_CVR) return { kind: "not_found" };
    const company = MOCK_COMPANIES[cvr] ?? fallback(cvr);
    return company.active ? { kind: "ok", company } : { kind: "ceased", company };
  }
}
