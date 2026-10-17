import { getEnv } from "../env";
import type { CompanyInfo, CvrLookupResult, CvrProvider } from "./types";

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const s = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/**
 * Erhvervsstyrelsens "CVR-data - System til System" (Elasticsearch).
 * Feltnavnene er skrevet efter vores bedste kendskab til dokumentationen og SKAL verificeres, når adgangen er på plads.
 */
export function mapVirkSource(cvr: string, src: Obj): CompanyInfo {
  const meta = o(src.virksomhedMetadata);
  const addr = o(meta.nyesteBeliggenhedsadresse);
  const branche = o(meta.nyesteHovedbranche);
  const form = o(meta.nyesteVirksomhedsform);
  const nav = o(meta.nyesteNavn);
  const staff = o(meta.nyesteAarsbeskaeftigelse ?? meta.nyesteKvartalsbeskaeftigelse ?? meta.nyesteMaanedsbeskaeftigelse);

  const house = [s(addr.husnummerFra), s(addr.bogstavFra)].filter(Boolean).join("");
  const floor = s(addr.etage) ? `, ${s(addr.etage)}.` : "";
  const door = s(addr.sidedoer) ? ` ${s(addr.sidedoer)}` : "";
  const address = [s(addr.vejnavn), house].filter(Boolean).join(" ") + floor + door;

  const status = s(meta.sammensatStatus);
  const active = /^(normal|aktiv)$/i.test(status);
  const start = s(meta.stiftelsesDato);
  const interval = s(staff.intervalKodeAntalAnsatte).replace(/^ANTAL_/, "").replace(/_/g, "-");

  return {
    cvr,
    name: s(nav.navn) || s(src.navn),
    address,
    zip: s(addr.postnummer),
    city: s(addr.postdistrikt),
    companyForm: s(form.langBeskrivelse) || s(form.kortBeskrivelse),
    industryCode: s(branche.branchekode),
    industryText: s(branche.branchetekst),
    startDate: /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : null,
    employees: interval || (s(staff.antalAnsatte) ? s(staff.antalAnsatte) : null),
    active,
    statusText: status || "Ukendt",
  };
}

export class VirkCvr implements CvrProvider {
  readonly name = "virk" as const;

  async lookup(cvr: string): Promise<CvrLookupResult> {
    const env = getEnv();
    if (!env.CVR_VIRK_USERNAME || !env.CVR_VIRK_PASSWORD) {
      return { kind: "error", message: "CVR-opslag er ikke sat op (CVR_VIRK_USERNAME/CVR_VIRK_PASSWORD mangler)." };
    }
    try {
      const res = await fetch(env.CVR_VIRK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: "Basic " + Buffer.from(`${env.CVR_VIRK_USERNAME}:${env.CVR_VIRK_PASSWORD}`).toString("base64"),
          "User-Agent": env.CVR_USER_AGENT,
        },
        body: JSON.stringify({ _source: ["Vrvirksomhed"], size: 1, query: { term: { "Vrvirksomhed.cvrNummer": Number(cvr) } } }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { kind: "error", message: `Virk svarede ${res.status}.` };
      const json = (await res.json()) as Obj;
      const hit = (o(json.hits).hits as unknown[] | undefined)?.[0];
      const source = o(o(o(hit)._source).Vrvirksomhed);
      if (!hit || Object.keys(source).length === 0) return { kind: "not_found" };
      const company = mapVirkSource(cvr, source);
      return company.active ? { kind: "ok", company } : { kind: "ceased", company };
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : "Ukendt fejl" };
    }
  }
}
