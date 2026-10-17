import { getEnv } from "../env";
import type { OutgoingEmail, OutgoingSms, SendResult } from "./types";

/**
 * inMobile (DK) API v4 via almindelig fetch – ingen SDK.
 *
 * ALT HERUNDER ER SKREVET EFTER BEDSTE VIDEN OG ER IKKE TESTET MOD EN RIGTIG KONTO (se docs/OPEN_ITEMS.md, "inMobile"):
 *  - autentificering: HTTP Basic, API-nøglen som adgangskode (`base64(":" + nøgle)`)
 *  - SMS:    POST {INMOBILE_API_URL}/v4/sms/outgoing  { messages: [{ to, text, from, countryHint, messageId, statusCallbackUrl }] }
 *  - E-mail: POST {INMOBILE_API_URL}/v4/email/outgoing { from, to[], subject, html, text, messageId, statusCallbackUrl }
 *  - svar: { results: [{ messageId | id, ... }] } (vi falder tilbage til vores eget messageId)
 */
export function inmobileAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`;
}

/** Statuswebhook-URL til inMobile (hemmeligheden ligger i URL'en, fordi vi ikke kender en signatur). */
export function statusCallbackUrl(): string {
  const env = getEnv();
  const base = env.APP_URL.replace(/\/$/, "");
  const secret = env.INMOBILE_WEBHOOK_SECRET;
  return `${base}/api/webhooks/inmobile${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`;
}

async function post(path: string, body: unknown): Promise<unknown> {
  const env = getEnv();
  if (!env.INMOBILE_API_KEY) throw new Error("INMOBILE_API_KEY er ikke sat.");
  const res = await fetch(`${env.INMOBILE_API_URL.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      Authorization: inmobileAuthHeader(env.INMOBILE_API_KEY),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`inMobile svarede ${res.status}: ${text.slice(0, 300)}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** Plukker udbyderens besked-id ud af svaret, tolerant over for varianter. */
export function extractProviderId(json: unknown, fallback: string): string {
  const j = json as { results?: { messageId?: unknown; id?: unknown }[]; messageId?: unknown; id?: unknown } | null;
  const first = j?.results?.[0];
  const id = first?.messageId ?? first?.id ?? j?.messageId ?? j?.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : fallback;
}

export function buildSmsBody(m: OutgoingSms) {
  return {
    messages: [
      {
        to: m.to,
        text: m.text,
        from: m.from,
        countryHint: "45",
        messageId: m.messageId,
        statusCallbackUrl: statusCallbackUrl(),
      },
    ],
  };
}

export function parseFromAddress(from: string): { email: string; name?: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: from.trim() };
}

export function buildEmailBody(m: OutgoingEmail, from: string) {
  return {
    from: parseFromAddress(from),
    to: [{ email: m.to, ...(m.toName ? { name: m.toName } : {}) }],
    subject: m.subject,
    text: m.text,
    html: m.html,
    messageId: m.messageId,
    statusCallbackUrl: statusCallbackUrl(),
  };
}

export async function inmobileSendSms(m: OutgoingSms): Promise<SendResult> {
  const json = await post("/v4/sms/outgoing", buildSmsBody(m));
  return { providerMessageId: extractProviderId(json, m.messageId) };
}

export async function inmobileSendEmail(m: OutgoingEmail): Promise<SendResult> {
  const json = await post("/v4/email/outgoing", buildEmailBody(m, getEnv().EMAIL_FROM));
  return { providerMessageId: extractProviderId(json, m.messageId ?? "") };
}

export type DeliveryStatus = "DELIVERED" | "FAILED";

/**
 * Fortolker statuswebhook (gæt): enten ét objekt, en liste eller { events | results | messages: [...] } med
 * { messageId, status | statusCode, ... }. Returnerer kun begivenheder, vi kan forstå.
 */
export function parseStatusEvents(payload: unknown): { messageId: string; status: DeliveryStatus; error?: string }[] {
  const root = payload as Record<string, unknown> | unknown[] | null;
  const list: unknown[] = Array.isArray(root)
    ? root
    : root && typeof root === "object"
      ? ((root.events ?? root.results ?? root.messages ?? [root]) as unknown[])
      : [];
  const out: { messageId: string; status: DeliveryStatus; error?: string }[] = [];
  for (const raw of list) {
    const e = raw as Record<string, unknown>;
    const id = e?.messageId ?? e?.id;
    if (typeof id !== "string" && typeof id !== "number") continue;
    const word = String(e.status ?? e.state ?? e.statusText ?? "").toLowerCase();
    const code = typeof e.statusCode === "number" ? e.statusCode : Number(e.statusCode);
    let status: DeliveryStatus | null = null;
    if (/deliver/.test(word) && !/undeliver|not/.test(word)) status = "DELIVERED";
    else if (/fail|reject|undeliver|expire|bounce|error/.test(word)) status = "FAILED";
    else if (Number.isFinite(code)) status = code >= 200 && code < 300 ? "DELIVERED" : code >= 400 ? "FAILED" : null;
    if (!status) continue;
    const error = status === "FAILED" ? String(e.errorMessage ?? e.error ?? e.reason ?? e.statusText ?? "Leveringen mislykkedes") : undefined;
    out.push({ messageId: String(id), status, error });
  }
  return out;
}

/** Indgående SMS (gæt): { from | msisdn, text | message }. STOP/AFMELD → afmelding. */
export function parseIncomingStop(payload: unknown): string | null {
  const list = Array.isArray(payload) ? payload : [payload];
  for (const raw of list) {
    const e = raw as Record<string, unknown> | null;
    if (!e || typeof e !== "object") continue;
    const from = e.from ?? e.msisdn ?? e.sender;
    const text = e.text ?? e.message ?? e.body;
    if (typeof from === "string" && typeof text === "string" && /^\s*(stop|afmeld|unsubscribe)\b/i.test(text)) return from;
  }
  return null;
}
