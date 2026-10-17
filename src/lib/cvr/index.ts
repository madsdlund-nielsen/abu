import { getEnv } from "../env";
import { CvrapiCvr } from "./cvrapi";
import { MockCvr } from "./mock";
import type { CvrLookupResult, CvrProvider } from "./types";
import { isValidCvr, normalizeCvr } from "./validate";
import { VirkCvr } from "./virk";

export type { CompanyInfo, CvrLookupResult } from "./types";
export { isValidCvr, normalizeCvr } from "./validate";

let provider: CvrProvider | null = null;
export function getCvrProvider(): CvrProvider {
  if (!provider) {
    const p = getEnv().CVR_PROVIDER;
    provider = p === "virk" ? new VirkCvr() : p === "cvrapi" ? new CvrapiCvr() : new MockCvr();
  }
  return provider;
}

const TTL_MS = 24 * 3_600_000;
const cache = new Map<string, { at: number; result: CvrLookupResult }>();

/** Opslag med 24 timers cache i hukommelsen. Fejl caches ikke. */
export async function lookupCvr(input: string): Promise<CvrLookupResult> {
  const cvr = normalizeCvr(input);
  if (!isValidCvr(cvr)) return { kind: "error", message: "Ugyldigt CVR-nummer." };
  const hit = cache.get(cvr);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;
  const result = await getCvrProvider().lookup(cvr);
  if (result.kind !== "error") {
    if (cache.size > 2000) cache.clear();
    cache.set(cvr, { at: Date.now(), result });
  }
  return result;
}
