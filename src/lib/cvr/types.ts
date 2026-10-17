/** Intern virksomhedsmodel, uafhængig af opslagstjenesten. */
export interface CompanyInfo {
  cvr: string;
  name: string;
  address: string;
  zip: string;
  city: string;
  companyForm: string;
  industryCode: string;
  industryText: string;
  /** ISO-dato (yyyy-mm-dd) eller null */
  startDate: string | null;
  /** Antal ansatte som interval, fx "10-19", eller null hvis ukendt */
  employees: string | null;
  /** true = virksomheden er aktiv/normal; false = ophørt */
  active: boolean;
  statusText: string;
}

export type CvrLookupResult =
  | { kind: "ok"; company: CompanyInfo }
  | { kind: "ceased"; company: CompanyInfo }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

export interface CvrProvider {
  readonly name: "mock" | "virk" | "cvrapi";
  lookup(cvr: string): Promise<CvrLookupResult>;
}
