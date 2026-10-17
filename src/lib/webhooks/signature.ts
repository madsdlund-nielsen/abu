import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Generisk verifikation af signerede webhooks (H-4, L-5): HMAC-SHA256 over den RÅ request-body (før JSON-parsing) plus et
 * signeret tidsstempel, der højst må være `toleranceSeconds` gammelt. Udbyderens præcise format (headernavn, nøgler,
 * hvad der signeres, hex/base64) beskrives af et `SignatureScheme`, så en ny udbyder kun kræver en ny konstant.
 */
export interface SignatureScheme {
  /** Header med signaturen (små bogstaver) */
  header: string;
  /**
   * combined: `t=<tidsstempel>,v1=<signatur>` i samme header (flere `v1` tilladt ved nøglerotation).
   * separate: signaturen alene i `header`, tidsstemplet i `timestampHeader`.
   */
  format: { kind: "combined"; timestampKey: string; signatureKey: string } | { kind: "separate"; timestampHeader: string };
  /** De bytes, der signeres, ud fra tidsstempel (som sendt) og rå body */
  payload: (timestamp: string, rawBody: string) => string;
  encoding: "hex" | "base64";
  /** Maks alder (og maks fremtid) for tidsstemplet i sekunder */
  toleranceSeconds: number;
}

export type VerifyFailure = "disabled" | "missing_secret" | "missing_header" | "malformed" | "bad_timestamp" | "stale" | "future" | "bad_signature";
export type VerifyResult = { ok: true; timestamp: Date } | { ok: false; reason: VerifyFailure };

type HeaderSource = Headers | Record<string, string | undefined>;
const getHeader = (h: HeaderSource, name: string) => (h instanceof Headers ? h.get(name) : (h[name] ?? h[name.toLowerCase()])) ?? "";

/** Tidsstempel som unix-sekunder, unix-millisekunder eller ISO 8601. */
export function parseWebhookTimestamp(value: string): Date | null {
  const v = value.trim();
  if (/^\d{10}$/.test(v)) return new Date(Number(v) * 1000);
  if (/^\d{13}$/.test(v)) return new Date(Number(v));
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Streng parsing af `k=v,k=v`: ingen tomme eller ukendte dele, ét tidsstempel, signaturer i korrekt format. */
function parseCombined(header: string, timestampKey: string, signatureKey: string): { t: string; sigs: string[] } | null {
  let t: string | null = null;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const m = /^\s*([A-Za-z0-9_-]+)=([^\s,=]+(?:=*))\s*$/.exec(part);
    if (!m) return null;
    const [, k, v] = m;
    if (k === timestampKey) {
      if (t !== null) return null;
      t = v;
    } else if (k === signatureKey) sigs.push(v);
    // andre nøgler (fx v0) ignoreres bevidst ikke: de afvises
    else return null;
  }
  return t && sigs.length ? { t, sigs } : null;
}

function wellFormed(sig: string, encoding: SignatureScheme["encoding"]): boolean {
  return encoding === "hex" ? /^[0-9a-f]{64}$/i.test(sig) : /^[A-Za-z0-9+/]{43}=$/.test(sig) || /^[A-Za-z0-9_-]{43}$/.test(sig);
}

export function computeSignature(scheme: SignatureScheme, timestamp: string, rawBody: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(scheme.payload(timestamp, rawBody), "utf8").digest();
  return scheme.encoding === "hex" ? mac.toString("hex") : mac.toString("base64");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyWebhookSignature(scheme: SignatureScheme, rawBody: string, headers: HeaderSource, secret: string, now = new Date()): VerifyResult {
  if (!secret) return { ok: false, reason: "missing_secret" };
  const raw = getHeader(headers, scheme.header);
  if (!raw) return { ok: false, reason: "missing_header" };
  let t: string;
  let sigs: string[];
  if (scheme.format.kind === "combined") {
    const parsed = parseCombined(raw, scheme.format.timestampKey, scheme.format.signatureKey);
    if (!parsed) return { ok: false, reason: "malformed" };
    ({ t, sigs } = parsed);
  } else {
    t = getHeader(headers, scheme.format.timestampHeader);
    if (!t) return { ok: false, reason: "missing_header" };
    sigs = [raw.trim()];
  }
  if (!sigs.every((s) => wellFormed(s, scheme.encoding))) return { ok: false, reason: "malformed" };
  const ts = parseWebhookTimestamp(t);
  if (!ts) return { ok: false, reason: "bad_timestamp" };
  const age = (now.getTime() - ts.getTime()) / 1000;
  if (age > scheme.toleranceSeconds) return { ok: false, reason: "stale" };
  if (age < -scheme.toleranceSeconds) return { ok: false, reason: "future" };
  const expected = computeSignature(scheme, t, rawBody, secret);
  const norm = (s: string) => (scheme.encoding === "hex" ? s.toLowerCase() : s.replace(/-/g, "+").replace(/_/g, "/").replace(/^([A-Za-z0-9+/]{43})$/, "$1="));
  return sigs.some((s) => safeEqual(norm(s), expected)) ? { ok: true, timestamp: ts } : { ok: false, reason: "bad_signature" };
}

/** Bygger en gyldig signatur-header (tests og dokumentation af formatet). */
export function signWebhook(scheme: SignatureScheme, rawBody: string, secret: string, timestamp: string): Record<string, string> {
  const sig = computeSignature(scheme, timestamp, rawBody, secret);
  if (scheme.format.kind === "combined") return { [scheme.header]: `${scheme.format.timestampKey}=${timestamp},${scheme.format.signatureKey}=${sig}` };
  return { [scheme.header]: sig, [scheme.format.timestampHeader]: timestamp };
}

/** Maks størrelse på en webhook-body; større afvises, før den læses ind (DoS). */
export const MAX_WEBHOOK_BYTES = 256 * 1024;

/** Læser body som tekst med loft på størrelsen. null = for stor. */
export async function readLimitedText(req: Request, max = MAX_WEBHOOK_BYTES): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
