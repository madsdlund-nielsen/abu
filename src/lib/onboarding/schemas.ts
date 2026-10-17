import { z } from "zod";
import { isValidCvr, normalizeCvr } from "../cvr/validate";
import { FREQUENCY_WEEKS } from "../pricing";
import { MIN_PASSWORD_LENGTH } from "../auth-constants";

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Indtast dit navn.").max(120, "Navnet er for langt."),
  email: z.string().trim().toLowerCase().email("Indtast en gyldig e-mailadresse.").max(200),
});

/** Dansk (8 cifre, evt. +45) eller internationalt format (+ og 8-15 cifre). */
export function normalizePhone(input: string): string | null {
  const t = input.trim().replace(/[\s().-]/g, "");
  if (/^(\+45|0045)?\d{8}$/.test(t)) {
    const d = t.replace(/^(\+45|0045)/, "");
    return `+45 ${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 6)} ${d.slice(6, 8)}`;
  }
  const intl = t.replace(/^00/, "+");
  if (/^\+[1-9]\d{7,14}$/.test(intl)) return intl;
  return null;
}

export const companyStepSchema = z.object({
  cvr: z
    .string()
    .transform(normalizeCvr)
    .refine((v) => /^\d{8}$/.test(v), "CVR-nummer skal være 8 cifre.")
    .refine((v) => !/^\d{8}$/.test(v) || isValidCvr(v), "CVR-nummeret er ugyldigt (kontrolcifrene stemmer ikke)."),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const n = normalizePhone(v);
      if (!n) ctx.addIssue({ code: "custom", message: "Indtast et gyldigt telefonnummer, fx 20 30 40 50 eller +46 70 123 45 67." });
      return n ?? "";
    }),
});

export const manualCompanySchema = z.object({
  name: z.string().trim().min(2, "Indtast virksomhedens navn.").max(200),
  address: z.string().trim().min(3, "Indtast virksomhedens adresse.").max(300),
});

export const accountSchema = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH, `Adgangskoden skal være mindst ${MIN_PASSWORD_LENGTH} tegn.`),
    confirm: z.string(),
    consent: z.literal("on", { error: "Du skal acceptere vilkår og privatlivspolitik for at fortsætte." }),
    recordingConsent: z.literal("on", { error: "Du skal give samtykke til optagelse og transskription af møder for at fortsætte." }),
  })
  .refine((v) => v.password === v.confirm, { message: "Adgangskoderne er ikke ens.", path: ["confirm"] });

export const boardSchema = z.object({
  advisorIds: z.array(z.string().min(1)).min(2, "Vælg mindst 2 rådgivere.").max(4, "Du kan højst vælge 4 rådgivere."),
  weeks: z.coerce
    .number()
    .refine((n) => (FREQUENCY_WEEKS as readonly number[]).includes(n), "Vælg hvor ofte I vil mødes."),
});

/** Svar på ét testspørgsmål: valgte svar-id'er. */
export function answerSchema(type: "SINGLE" | "MULTI") {
  return z
    .array(z.string().min(1))
    .min(1, "Vælg mindst ét svar.")
    .refine((a) => type === "MULTI" || a.length === 1, "Vælg ét svar.");
}
