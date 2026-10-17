import type { NotificationChannel } from "@prisma/client";
import { KNOWN_VARIABLES } from "./triggers";

const VARIABLE_RE = /\{\{\s*([\p{L}\p{N}_]+)\s*\}\}/gu;

/** Variabler brugt i en tekst, i rækkefølge og uden dubletter. */
export function extractVariables(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(VARIABLE_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export interface TemplateInput {
  channel: NotificationChannel;
  name?: string;
  subject?: string | null;
  body: string;
}

export interface TemplateIssue {
  field: "name" | "subject" | "body";
  message: string;
  /** Ukendte variabler, hvis fejlen handler om dem */
  variables?: string[];
}

export const MAX_SMS_PARTS = 6;
export const MAX_BODY_LENGTH = 5000;

/** Ufuldstændige {{ eller }} i teksten, når de rigtige variabler er fjernet. */
function strayBraces(text: string): boolean {
  return /\{\{|\}\}/.test(text.replace(VARIABLE_RE, ""));
}

/**
 * Validerer en skabelon: tom tekst, ukendte variabler, ufuldstændige {{…}}, emne til e-mail og SMS-længde.
 * `allowed` begrænser til en udløsers variabler (ellers accepteres alle kendte variabler).
 */
export function validateTemplate(t: TemplateInput, allowed?: readonly string[]): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const known = new Set(allowed ?? KNOWN_VARIABLES);
  if (t.name !== undefined && t.name.trim().length < 2) issues.push({ field: "name", message: "Giv skabelonen et navn." });
  if (t.channel === "EMAIL" && !(t.subject ?? "").trim()) issues.push({ field: "subject", message: "E-mailen skal have et emne." });
  if (!t.body.trim()) issues.push({ field: "body", message: "Teksten må ikke være tom." });
  if (t.body.length > MAX_BODY_LENGTH) issues.push({ field: "body", message: `Teksten er for lang (maks ${MAX_BODY_LENGTH} tegn).` });

  const check = (field: "subject" | "body", text: string) => {
    const unknown = extractVariables(text).filter((v) => !known.has(v));
    if (unknown.length > 0) {
      const list = unknown.map((v) => `{{${v}}}`).join(", ");
      issues.push({
        field,
        variables: unknown,
        message: `${unknown.length === 1 ? "Ukendt variabel" : "Ukendte variabler"}: ${list}.${allowed ? " Findes ikke for denne udløser." : ""}`,
      });
    }
    if (strayBraces(text)) issues.push({ field, message: "Der er en ufuldstændig {{variabel}} i teksten. Tjek tuborgklammerne." });
  };
  check("body", t.body);
  if (t.channel === "EMAIL" && t.subject) {
    check("subject", t.subject);
    if (/[\r\n]/.test(t.subject)) issues.push({ field: "subject", message: "Emnet må ikke indeholde linjeskift." });
  }
  if (t.channel === "SMS" && t.body.trim()) {
    const seg = smsSegments(t.body);
    if (seg.segments > MAX_SMS_PARTS) issues.push({ field: "body", message: `SMS'en fylder ${seg.segments} dele. Hold den under ${MAX_SMS_PARTS + 1}.` });
  }
  return issues;
}

/** Udfylder {{variabler}}. Manglende værdier bliver til tom tekst. */
export function renderTemplate(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(VARIABLE_RE, (_, name: string) => vars[name] ?? "");
}

// --------------------------------------------------------------------------- SMS-segmenter

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";
const BASIC_SET = new Set(GSM7_BASIC);
const EXT_SET = new Set(GSM7_EXT);

export interface SmsSegmentInfo {
  encoding: "GSM-7" | "UCS-2";
  /** Tegn (GSM-7: inkl. dobbelte for udvidede tegn; UCS-2: UTF-16-enheder) */
  length: number;
  segments: number;
  /** Tegn pr. SMS-del i denne kodning (enkelt / sammensat) */
  perSegment: number;
  /** Ledige tegn i den sidste del */
  remaining: number;
}

/**
 * Tæller SMS-dele. GSM-7 (æ, ø, å, € mv. er med): 160 tegn i én SMS, 153 pr. del i sammensatte. Hvis teksten har tegn uden for GSM-7
 * (fx emoji eller «»), bruges UCS-2: 70 / 67 tegn. Udvidede GSM-tegn (^ { } \ [ ~ ] | €) fylder to.
 */
export function smsSegments(text: string): SmsSegmentInfo {
  let gsmLength = 0;
  let gsm = true;
  for (const ch of text) {
    if (BASIC_SET.has(ch)) gsmLength += 1;
    else if (EXT_SET.has(ch)) gsmLength += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    const single = 160;
    const multi = 153;
    const segments = gsmLength === 0 ? 0 : gsmLength <= single ? 1 : Math.ceil(gsmLength / multi);
    const perSegment = segments <= 1 ? single : multi;
    return { encoding: "GSM-7", length: gsmLength, segments, perSegment, remaining: segments === 0 ? single : segments * perSegment - gsmLength };
  }
  const length = text.length; // UTF-16-enheder
  const single = 70;
  const multi = 67;
  const segments = length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / multi);
  const perSegment = segments <= 1 ? single : multi;
  return { encoding: "UCS-2", length, segments, perSegment, remaining: segments * perSegment - length };
}
