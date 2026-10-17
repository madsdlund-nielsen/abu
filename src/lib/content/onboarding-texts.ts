/**
 * Redigerbare tekster i onboarding (CMS: Admin → Onboarding → Tekster). Standardteksterne ligger her i koden;
 * en tekst, der er ændret i CMS'et, gemmes som ContentBlock og overstyrer standarden. Manglende nøgler falder tilbage til standarden.
 *
 * Tekster kan bruge pladsholdere i {tuborgklammer} (vises som chips i CMS'et) og letvægts-markdown: **fed** og [tekst](/sti).
 */
export interface TextDef {
  key: string;
  /** 0 = fælles, 1-6 = onboarding-trin */
  step: number;
  label: string;
  hint?: string;
  default: string;
  multiline?: boolean;
  max?: number;
  /** Tilladte pladsholdere, fx ["cvr", "navn"] */
  vars?: string[];
  /** Samtykketekst: ændring opretter en ny version */
  consent?: boolean;
}

export const STEP_GROUPS: { step: number; title: string; short: string }[] = [
  { step: 0, title: "Fælles", short: "Fælles" },
  { step: 1, title: "Trin 1 · Kontakt", short: "Kontakt" },
  { step: 2, title: "Trin 2 · Virksomhed", short: "Virksomhed" },
  { step: 3, title: "Trin 3 · Bekræft", short: "Bekræft" },
  { step: 4, title: "Trin 4 · Test", short: "Test" },
  { step: 5, title: "Trin 5 · Dit board", short: "Dit board" },
  { step: 6, title: "Trin 6 · Konto og betaling", short: "Konto" },
];

export const MARKETING_CONSENT_KEY = "step1.consent";
export const RECORDING_CONSENT_KEY = "step6.recordingConsent";

export const TEXT_DEFS: TextDef[] = [
  // ------------------------------------------------------------------ Fælles
  { key: "common.eyebrow", step: 0, label: "Over-titel (eyebrow)", hint: "Vises over hver trins overskrift.", default: "Trin {n} af {total} · {trin}", vars: ["n", "total", "trin"], max: 80 },
  { key: "common.back", step: 0, label: "Knap: Tilbage", default: "Tilbage", max: 40 },
  { key: "common.next", step: 0, label: "Knap: Næste", default: "Næste", max: 40 },
  { key: "common.stepLabel1", step: 0, label: "Trinnavn 1", default: "Kontakt", max: 24 },
  { key: "common.stepLabel2", step: 0, label: "Trinnavn 2", default: "Virksomhed", max: 24 },
  { key: "common.stepLabel3", step: 0, label: "Trinnavn 3", default: "Bekræft", max: 24 },
  { key: "common.stepLabel4", step: 0, label: "Trinnavn 4", default: "Test", max: 24 },
  { key: "common.stepLabel5", step: 0, label: "Trinnavn 5", default: "Dit board", max: 24 },
  { key: "common.stepLabel6", step: 0, label: "Trinnavn 6", default: "Konto & betaling", max: 24 },
  { key: "error.tooMany", step: 0, label: "Fejl: for mange forsøg", default: "For mange forsøg. Prøv igen senere.", max: 200 },
  { key: "error.accountExists", step: 0, label: "Fejl: konto findes allerede", hint: "Efterfølges af et «Log ind her»-link.", default: "Der findes allerede en konto med den e-mail.", max: 200 },

  // ------------------------------------------------------------------ Trin 1
  { key: "step1.title", step: 1, label: "Overskrift", default: "Hvem er du?", max: 80 },
  { key: "step1.intro", step: 1, label: "Indledning", default: "Vi starter med dine kontaktoplysninger. Det tager under fem minutter at sætte dit board.", multiline: true, max: 400 },
  { key: "step1.nameLabel", step: 1, label: "Felt: navn", default: "Dit navn", max: 60 },
  { key: "step1.emailLabel", step: 1, label: "Felt: e-mail", default: "E-mail", max: 60 },
  {
    key: MARKETING_CONSENT_KEY,
    step: 1,
    label: "Samtykke til kontakt (afkrydsningsfelt)",
    hint: "Aldrig forudkrydset. Teksten gemmes ordret sammen med hvert samtykke.",
    default:
      "Ja tak, I må gerne kontakte mig på e-mail og SMS med opfølgning og relevante tilbud fra Advisory Board Unlimited. Jeg kan altid trække samtykket tilbage.",
    multiline: true,
    max: 500,
    consent: true,
  },
  { key: "step1.loginHint", step: 1, label: "Tekst: har du allerede en konto?", hint: "Skriv fx [Log ind](/login) for at lave et link.", default: "Har du allerede en konto? [Log ind](/login)", max: 200 },
  { key: "step1.submit", step: 1, label: "Knap", default: "Næste", max: 40 },

  // ------------------------------------------------------------------ Trin 2
  { key: "step2.title", step: 2, label: "Overskrift", default: "Fortæl om virksomheden", max: 80 },
  { key: "step2.intro", step: 2, label: "Indledning", default: "Vi henter jeres virksomhedsoplysninger i CVR-registret, så du ikke skal taste dem.", multiline: true, max: 400 },
  { key: "step2.cvrLabel", step: 2, label: "Felt: CVR-nummer", default: "CVR-nummer", max: 60 },
  { key: "step2.cvrPlaceholder", step: 2, label: "Eksempeltekst: CVR", default: "8 cifre", max: 60 },
  { key: "step2.phoneLabel", step: 2, label: "Felt: telefonnummer", default: "Telefonnummer", max: 60 },
  { key: "step2.phonePlaceholder", step: 2, label: "Eksempeltekst: telefon", default: "20 30 40 50 eller +46 70 123 45 67", max: 80 },
  { key: "step2.submit", step: 2, label: "Knap", default: "Slå virksomhed op", max: 40 },

  // ------------------------------------------------------------------ Trin 3
  { key: "step3.title", step: 3, label: "Overskrift", default: "Bekræft din virksomhed", max: 80 },
  { key: "step3.source", step: 3, label: "Kildetekst under virksomhedskortet", default: "Data fra CVR-registret (Erhvervsstyrelsen). Er det den rigtige virksomhed?", max: 200 },
  { key: "step3.confirm", step: 3, label: "Knap: bekræft", default: "Bekræft og fortsæt", max: 40 },
  { key: "step3.wrong", step: 3, label: "Link: forkert virksomhed", default: "Forkert virksomhed? Ret CVR-nummeret.", max: 100 },
  { key: "step3.ceasedTitle", step: 3, label: "Ophørt: overskrift", default: "Virksomheden er ophørt", max: 100 },
  {
    key: "step3.ceasedBody",
    step: 3,
    label: "Ophørt: tekst",
    default: "CVR {cvr} ({navn}) står som «{status}» i CVR-registret. Vi kan kun oprette abonnementer for aktive virksomheder.",
    vars: ["cvr", "navn", "status"],
    multiline: true,
    max: 400,
  },
  { key: "step3.notFoundTitle", step: 3, label: "Ikke fundet: overskrift", default: "Vi kunne ikke finde CVR-nummeret", max: 100 },
  { key: "step3.notFoundBody", step: 3, label: "Ikke fundet: tekst", default: "CVR {cvr} findes ikke i CVR-registret. Tjek nummeret, eller indtast oplysningerne selv.", vars: ["cvr"], multiline: true, max: 400 },
  { key: "step3.errorTitle", step: 3, label: "Opslag fejlede: overskrift", default: "CVR-opslaget fejlede", max: 100 },
  { key: "step3.errorBody", step: 3, label: "Opslag fejlede: tekst", default: "Vi kunne ikke kontakte CVR-registret lige nu. Prøv igen, eller indtast oplysningerne selv.", multiline: true, max: 400 },
  { key: "step3.quotaBody", step: 3, label: "Opslag fejlede (kvote opbrugt): tekst", default: "CVR-opslaget har nået dagens grænse. Du kan fortsætte ved selv at indtaste oplysningerne.", multiline: true, max: 400 },
  { key: "step3.manualIntro", step: 3, label: "Manuel indtastning: forklaring", default: "Indtast virksomhedens oplysninger manuelt. De markeres som «ikke verificeret», og vi kontrollerer dem.", multiline: true, max: 400 },
  { key: "step3.manualName", step: 3, label: "Manuel: felt navn", default: "Virksomhedens navn", max: 60 },
  { key: "step3.manualAddress", step: 3, label: "Manuel: felt adresse", default: "Adresse, postnr. og by", max: 60 },
  { key: "step3.manualSubmit", step: 3, label: "Manuel: knap", default: "Fortsæt uden opslag", max: 40 },

  // ------------------------------------------------------------------ Trin 4
  { key: "step4.title", step: 4, label: "Overskrift", default: "Hvad har I brug for?", max: 80 },
  { key: "step4.empty", step: 4, label: "Ingen spørgsmål: tekst", default: "Vi har ingen spørgsmål lige nu, så vi laver et standardforslag til dit board.", multiline: true, max: 300 },
  { key: "step4.emptySubmit", step: 4, label: "Ingen spørgsmål: knap", default: "Se forslag", max: 40 },
  { key: "step4.progress", step: 4, label: "Fremdrift", default: "Spørgsmål {n} af {total}", vars: ["n", "total"], max: 60 },
  { key: "step4.single", step: 4, label: "Hint: ét svar", default: "Vælg ét svar", max: 60 },
  { key: "step4.multi", step: 4, label: "Hint: flere svar", default: "Vælg gerne flere", max: 60 },
  { key: "step4.next", step: 4, label: "Knap: næste spørgsmål", default: "Næste", max: 40 },
  { key: "step4.last", step: 4, label: "Knap: sidste spørgsmål", default: "Se dit forslag", max: 40 },

  // ------------------------------------------------------------------ Trin 5
  { key: "step5.title", step: 5, label: "Overskrift", default: "Sammensæt dit board", max: 80 },
  { key: "step5.introTest", step: 5, label: "Indledning (efter test)", default: "Ud fra jeres svar foreslår vi {antal} rådgivere, der supplerer hinanden. Du kan udskifte, tilføje eller fjerne rådgivere, og prisen opdateres med det samme.", vars: ["antal"], multiline: true, max: 500 },
  { key: "step5.introNoTest", step: 5, label: "Indledning (uden test)", default: "Vi har sammensat et forslag. Du kan udskifte, tilføje eller fjerne rådgivere, og prisen opdateres med det samme.", multiline: true, max: 500 },
  { key: "step5.sideEyebrow", step: 5, label: "Sidepanel: over-titel", default: "Dit board", max: 40 },
  { key: "step5.replace", step: 5, label: "Knap: udskift", default: "Udskift", max: 30 },
  { key: "step5.remove", step: 5, label: "Knap: fjern", default: "Fjern", max: 30 },
  { key: "step5.add", step: 5, label: "Knap: tilføj rådgiver", default: "Tilføj rådgiver", max: 40 },
  { key: "step5.frequency", step: 5, label: "Overskrift: mødefrekvens", default: "Mødefrekvens", max: 40 },
  { key: "step5.priceLabel", step: 5, label: "Prisetiket", default: "Månedspris (ekskl. moms)", max: 60 },
  { key: "step5.catalogEyebrow", step: 5, label: "Katalog: over-titel", default: "Rådgiverkatalog", max: 40 },
  { key: "step5.submit", step: 5, label: "Knap: fortsæt", default: "Fortsæt", max: 40 },

  // ------------------------------------------------------------------ Trin 6
  { key: "step6.title", step: 6, label: "Overskrift", default: "Opret konto og betal", max: 80 },
  { key: "step6.summaryLabel", step: 6, label: "Resumé: overskrift", default: "Dit abonnement", max: 60 },
  { key: "step6.passwordLabel", step: 6, label: "Felt: adgangskode", default: "Adgangskode (mindst {min} tegn)", vars: ["min"], max: 80 },
  { key: "step6.confirmLabel", step: 6, label: "Felt: gentag adgangskode", default: "Gentag adgangskode", max: 60 },
  {
    key: "step6.terms",
    step: 6,
    label: "Accept af vilkår",
    hint: "Brug [vilkårene](/vilkaar) og [privatlivspolitikken](/privatliv) for links.",
    default: "Jeg accepterer [vilkårene](/vilkaar) og har læst [privatlivspolitikken](/privatliv).",
    multiline: true,
    max: 400,
  },
  {
    key: RECORDING_CONSENT_KEY,
    step: 6,
    label: "Samtykke til optagelse og transskription",
    hint: "Gemmes som samtykke på kontoen. Ændring opretter en ny version.",
    default:
      "**Samtykke til optagelse og transskription.** Jeg giver samtykke til, at møder optages og transskriberes automatisk, så deltagerne kan læse en transskription og et resumé efter mødet. Optagelsen slettes, når transskriptionen er færdig. Du kan trække samtykket tilbage ved at kontakte os.",
    multiline: true,
    max: 800,
    consent: true,
  },
  { key: "step6.submit", step: 6, label: "Knap: opret konto", default: "Opret konto og betal", max: 40 },
];

export const TEXT_BY_KEY: Record<string, TextDef> = Object.fromEntries(TEXT_DEFS.map((d) => [d.key, d]));
export const DEFAULTS: Record<string, string> = Object.fromEntries(TEXT_DEFS.map((d) => [d.key, d.default]));

export type OnboardingTexts = Record<string, string>;

/** Standardtekster med de ændrede tekster ovenpå. Ukendte nøgler i databasen ignoreres. */
export function resolveTexts(overrides: Record<string, string | undefined>): OnboardingTexts {
  const out: OnboardingTexts = { ...DEFAULTS };
  for (const [k, v] of Object.entries(overrides)) {
    if (k in DEFAULTS && typeof v === "string" && v.trim() !== "") out[k] = v;
  }
  return out;
}

/** Erstatter {pladsholdere}. Ukendte pladsholdere bliver stående, så en tastefejl er synlig. */
export function interpolate(text: string, vars: Record<string, string | number | undefined> = {}): string {
  return text.replace(/\{([a-zæøåA-ZÆØÅ_]+)\}/g, (m, name: string) => (name in vars && vars[name] !== undefined ? String(vars[name]) : m));
}

export interface TextIssue {
  message: string;
}

/** Validerer en redigeret tekst: ikke tom, ikke for lang, kun tilladte pladsholdere og gyldige links. */
export function validateText(def: TextDef, value: string): string | null {
  const v = value.trim();
  if (!v) return null; // tom = gendan standard
  if (def.max && v.length > def.max) return `Teksten er for lang (maks ${def.max} tegn).`;
  const allowed = new Set(def.vars ?? []);
  const bad = [...v.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).filter((n) => !allowed.has(n));
  if (bad.length) {
    return allowed.size
      ? `Ukendt pladsholder: {${bad[0]}}. Tilladt: ${[...allowed].map((a) => `{${a}}`).join(", ")}.`
      : `Denne tekst har ingen pladsholdere, men indeholder {${bad[0]}}.`;
  }
  for (const m of v.matchAll(/\]\(([^)]*)\)/g)) {
    if (!isSafeHref(m[1])) return `Ugyldigt link: ${m[1]}. Brug en sti som /login eller en adresse, der starter med https://.`;
  }
  if (!def.multiline && /\n/.test(v)) return "Teksten må ikke indeholde linjeskift.";
  return null;
}

export function isSafeHref(href: string): boolean {
  return (href.startsWith("/") && !href.startsWith("//")) || href.startsWith("https://");
}

export type RichNode = { type: "text"; text: string } | { type: "bold"; text: string } | { type: "link"; text: string; href: string };

/** Letvægts-markdown: **fed** og [tekst](sti). Alt andet er ren tekst; usikre links vises som tekst. */
export function parseRich(text: string): RichNode[] {
  const nodes: RichNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]*)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) nodes.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) nodes.push({ type: "bold", text: m[1] });
    else if (isSafeHref(m[3])) nodes.push({ type: "link", text: m[2], href: m[3] });
    else nodes.push({ type: "text", text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes;
}

/** Version af en samtykketekst: "v<n>" – n hæves ved hver ændring i CMS'et (1 = standardteksten). */
export function consentVersion(prefix: string, row: { version: number } | undefined | null): string {
  return `${prefix}${row ? row.version : 0}`;
}
