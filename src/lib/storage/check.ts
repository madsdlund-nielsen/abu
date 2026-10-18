import { Readable } from "node:stream";
import { randomToken } from "../tokens";
import type { StorageProvider } from "./types";

export interface CheckLine {
  ok: boolean;
  /** «advarsel» = virker, men noget bør rettes */
  warn?: boolean;
  text: string;
}

export interface S3CheckTarget {
  /** Objektets offentlige adresse (uden signatur) – skal give 403, fordi bucketten er privat */
  objectUrl: (key: string) => string;
  /** Adressen, browseren uploader til (presigned POST) – til CORS-tjekket */
  uploadUrl: string;
  /** APP_URL's origin */
  appOrigin: string;
  fetch?: typeof fetch;
}

/**
 * `npm run storage:check`: skriver, læser og sletter et testobjekt via appens egen storage-adapter. Med S3 tjekkes
 * desuden, at bucketten er privat (anonym GET afvises), og at CORS tillader direkte upload fra APP_URL.
 */
export async function runStorageCheck(storage: Pick<StorageProvider, "name" | "putStream" | "openStream" | "stat" | "delete">, s3?: S3CheckTarget): Promise<CheckLine[]> {
  const lines: CheckLine[] = [];
  const key = `healthcheck/storage-check-${randomToken(9)}.txt`;
  const payload = Buffer.from(`ABU storage:check ${new Date().toISOString()}`);
  try {
    await storage.putStream(key, Readable.from([payload]), { maxBytes: 1024, contentType: "text/plain" });
    lines.push({ ok: true, text: `Skrev testobjektet ${key} (${payload.length} bytes).` });
  } catch (e) {
    lines.push({ ok: false, text: `Kunne ikke skrive til lageret: ${errorText(e)}. Tjek endpoint, bucket-navn, region og nøgler.` });
    return lines;
  }
  try {
    const obj = await storage.openStream(key);
    const chunks: Buffer[] = [];
    if (obj) for await (const c of obj.body) chunks.push(Buffer.from(c));
    const same = obj !== null && Buffer.concat(chunks).equals(payload);
    lines.push(same ? { ok: true, text: "Læste testobjektet tilbage – indholdet er identisk." } : { ok: false, text: "Testobjektet kunne ikke læses tilbage med samme indhold." });

    if (s3) {
      const f = s3.fetch ?? fetch;
      try {
        const anon = await f(s3.objectUrl(key), { method: "GET" });
        lines.push(
          anon.status === 403 || anon.status === 401
            ? { ok: true, text: `Bucketten er privat: anonym læsning afvises (HTTP ${anon.status}).` }
            : anon.ok
              ? { ok: false, text: "Bucketten er OFFENTLIG: testobjektet kunne hentes uden nøgle. Sæt bucketten til «Private» i Hetzner Console." }
              : { ok: true, warn: true, text: `Anonym læsning gav HTTP ${anon.status} (forventet 403). Tjek, at bucketten er privat.` },
        );
      } catch (e) {
        lines.push({ ok: true, warn: true, text: `Kunne ikke teste anonym adgang: ${errorText(e)}.` });
      }
      try {
        const pre = await f(s3.uploadUrl, { method: "OPTIONS", headers: { Origin: s3.appOrigin, "Access-Control-Request-Method": "POST" } });
        const allow = pre.headers.get("access-control-allow-origin");
        lines.push(
          allow === s3.appOrigin || allow === "*"
            ? { ok: true, text: `CORS tillader direkte upload (POST) fra ${s3.appOrigin}.` }
            : { ok: true, warn: true, text: `CORS mangler for ${s3.appOrigin} (HTTP ${pre.status}). Manuel upload af optagelser virker først, når CORS-reglen fra docs/HETZNER-S3.md er sat.` },
        );
      } catch (e) {
        lines.push({ ok: true, warn: true, text: `Kunne ikke teste CORS: ${errorText(e)}.` });
      }
    }
  } finally {
    try {
      await storage.delete(key);
      const gone = (await storage.stat(key)) === null;
      lines.push(gone ? { ok: true, text: "Slettede testobjektet igen." } : { ok: false, text: "Testobjektet findes stadig efter sletning." });
    } catch (e) {
      lines.push({ ok: false, text: `Kunne ikke slette testobjektet: ${errorText(e)}. Nøglen skal have skriveadgang (inkl. sletning).` });
    }
  }
  return lines;
}

function errorText(e: unknown): string {
  if (e instanceof Error) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    return `${e.name}${status ? ` (HTTP ${status})` : ""}: ${e.message.slice(0, 200)}`;
  }
  return String(e);
}
