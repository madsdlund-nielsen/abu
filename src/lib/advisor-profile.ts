import { z } from "zod";
import { normalizePhone } from "./onboarding/schemas";

/**
 * Rådgiverens profilfelter. Samme validering, uanset om rådgiveren selv (`/profile`) eller admin
 * (`/admin/advisors/[id]`) redigerer: titel, præsentation og mobilnummer. Profilbilledet uploades for sig (`src/lib/avatar.ts`);
 * der er ikke længere en foto-URL (eksterne billeder lækkede besøgendes IP-adresser til tredjepart).
 */
export const advisorProfileSchema = z.object({
  title: z.string().trim().max(120, "Titlen må højst være 120 tegn."),
  bio: z.string().trim().max(4000, "Præsentationen må højst være 4.000 tegn."),
  phone: z.string().trim().max(30, "Telefonnummeret er for langt.").optional(),
});

/** Rådgiverens egen formular har også navnet. */
export const advisorOwnProfileSchema = advisorProfileSchema.extend({
  name: z.string().trim().min(2, "Indtast dit navn (mindst 2 tegn)."),
});

export const PROFILE_FIELDS = ["title", "bio", "phone"] as const;

export interface ParsedAdvisorProfile {
  title: string;
  bio: string;
  /** Normaliseret (+45 20 30 40 50) eller null, når feltet er tomt */
  phone: string | null;
}

const PHONE_ERROR = "Indtast et gyldigt telefonnummer, fx 20 30 40 50 eller +46 70 123 45 67.";

/** Normalisér telefonnummeret efter zod-valideringen. */
export function profilePhone(raw: string | undefined): { phone: string | null } | { error: string } {
  const v = raw ?? "";
  if (v === "") return { phone: null };
  const phone = normalizePhone(v);
  return phone ? { phone } : { error: PHONE_ERROR };
}

/** Validér profilfelterne (admin-tilstand). Returnerer første fejl på dansk. */
export function parseAdvisorProfile(values: Record<string, string | undefined>): { ok: true; data: ParsedAdvisorProfile } | { ok: false; error: string } {
  const p = advisorProfileSchema.safeParse(values);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Ugyldige felter." };
  const ph = profilePhone(p.data.phone);
  if ("error" in ph) return { ok: false, error: ph.error };
  return { ok: true, data: { title: p.data.title, bio: p.data.bio, phone: ph.phone } };
}
