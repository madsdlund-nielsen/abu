import { getEnv } from "../env";
import type { CompanyInfo, CvrLookupResult, CvrProvider } from "./types";

type Obj = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** cvrapi.dk skriver datoer som "01/03 - 2016" (dd/mm - åååå). */
export function parseCvrapiDate(v: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2}) - (\d{4})$/.exec(v.trim());
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/** Feltnavne (vat, name, address, zipcode, city, companydesc, industrycode, industrydesc, startdate, enddate, employees) efter cvrapi.dk's dokumentation; skal verificeres. */
export function mapCvrapi(cvr: string, j: Obj): CompanyInfo {
  const ended = Boolean(j.enddate) || j.companystatus === "OPHØRT";
  return {
    cvr,
    name: s(j.name),
    address: s(j.address),
    zip: s(j.zipcode),
    city: s(j.city),
    companyForm: s(j.companydesc),
    industryCode: s(j.industrycode),
    industryText: s(j.industrydesc),
    startDate: parseCvrapiDate(s(j.startdate)),
    employees: s(j.employees) || null,
    active: !ended,
    statusText: ended ? "Ophørt" : "Normal",
  };
}

export class CvrapiCvr implements CvrProvider {
  readonly name = "cvrapi" as const;

  async lookup(cvr: string): Promise<CvrLookupResult> {
    try {
      const res = await fetch(`https://cvrapi.dk/api?search=${encodeURIComponent(cvr)}&country=dk`, {
        headers: { "User-Agent": getEnv().CVR_USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 404) return { kind: "not_found" };
      if (res.status === 429) return { kind: "error", message: "Kvoten hos cvrapi.dk er opbrugt." };
      if (!res.ok) return { kind: "error", message: `cvrapi.dk svarede ${res.status}.` };
      const json = (await res.json()) as Obj;
      if (json.error) return json.error === "NOT_FOUND" ? { kind: "not_found" } : { kind: "error", message: String(json.error) };
      const company = mapCvrapi(cvr, json);
      return company.active ? { kind: "ok", company } : { kind: "ceased", company };
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : "Ukendt fejl" };
    }
  }
}
