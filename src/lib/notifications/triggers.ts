import type { NotificationAudience, NotificationChannel } from "@prisma/client";

/**
 * Registeret over udløsere (triggere) i notifikationssystemet. CMS'et, planlæggeren og valideringen bruger alle dette register.
 *
 *  - `before_start`: tidspunktet regnes ud fra mødets start (offset er negativt: "24 timer før mødet").
 *  - `event`: tidspunktet regnes ud fra hændelsen (offset 0 = straks, ellers "efter hændelsen").
 *  - `after_activity`: tidspunktet regnes ud fra seneste aktivitet i en ufærdig tilmelding.
 */
export type TimingKind = "before_start" | "event" | "after_activity";

export type TriggerGroup = "Møder" | "Abonnement og board" | "Onboarding" | "Konto";

export const TRIGGER_KEYS = [
  "meeting_booked",
  "meeting_reminder",
  "meeting_rescheduled",
  "meeting_cancelled",
  "meeting_participant_changed",
  "transcript_ready",
  "board_changed",
  "payment_failed",
  "onboarding_abandoned",
  "advisor_invited",
  "password_reset",
  "account_exists",
] as const;
export type TriggerKey = (typeof TRIGGER_KEYS)[number];

export interface TriggerDef {
  key: TriggerKey;
  label: string;
  group: TriggerGroup;
  description: string;
  timing: TimingKind;
  /** Transaktionel og låst: kan ikke slås fra eller slettes (teksten kan stadig redigeres). */
  locked: boolean;
  /** Kræver aktivt samtykke og skal have afmelding (modtageren er endnu ikke kunde). */
  optIn: boolean;
  /** Indeholder engangslinks, der ikke må gemmes i loggen. */
  sensitive: boolean;
  audiences: NotificationAudience[];
  /** Variabler, der kan bruges i skabeloner til denne udløser */
  variables: string[];
  /** Forklaring til hvem "rådgivere" er for denne udløser */
  audienceNote?: string;
}

const COMMON = ["fornavn", "navn", "afmeldlink"];
const MEETING = [...COMMON, "virksomhed", "mødedato", "mødedato_kort", "mødetid", "rådgivere", "mødelink"];

export const TRIGGERS: Record<TriggerKey, TriggerDef> = {
  meeting_booked: {
    key: "meeting_booked",
    label: "Møde booket",
    group: "Møder",
    description: "Sendes, når et møde er booket.",
    timing: "event",
    locked: false,
    optIn: false,
    sensitive: false,
    audiences: ["CUSTOMER", "ADVISORS", "BOTH"],
    variables: MEETING,
  },
  meeting_reminder: {
    key: "meeting_reminder",
    label: "Påmindelse før møde",
    group: "Møder",
    description: "Sendes et valgt stykke tid før mødet starter. Flyttes eller aflyses mødet, justeres eller annulleres påmindelserne.",
    timing: "before_start",
    locked: false,
    optIn: false,
    sensitive: false,
    audiences: ["CUSTOMER", "ADVISORS", "BOTH"],
    variables: MEETING,
  },
  meeting_rescheduled: {
    key: "meeting_rescheduled",
    label: "Møde flyttet",
    group: "Møder",
    description: "Sendes, når et møde er flyttet til et nyt tidspunkt.",
    timing: "event",
    locked: false,
    optIn: false,
    sensitive: false,
    audiences: ["CUSTOMER", "ADVISORS", "BOTH"],
    variables: MEETING,
  },
  meeting_cancelled: {
    key: "meeting_cancelled",
    label: "Møde aflyst",
    group: "Møder",
    description: "Sendes, når et møde er aflyst.",
    timing: "event",
    locked: false,
    optIn: false,
    sensitive: false,
    audiences: ["CUSTOMER", "ADVISORS", "BOTH"],
    variables: MEETING,
  },
  meeting_participant_changed: {
    key: "meeting_participant_changed",
    label: "Deltagere ændret",
    group: "Møder",
    description: "Sendes, når admin har udskiftet, tilføjet eller fjernet en rådgiver i ét møde.",
    timing: "event",
    locked: false,
    optIn: false,
    sensitive: false,
    audiences: ["CUSTOMER", "ADVISORS", "BOTH"],
    variables: [...MEETING, "ændring", "ny_rådgiver", "fjernet_rådgiver"],
    audienceNote: "«Rådgivere» er de berørte rådgivere: den tilføjede og den fjernede.",
  },
  transcript_ready: {
    key: "transcript_ready",
    label: "Transskription og resumé klar",
    group: "Møder",
    description: "Sendes, når mødets transskription og resumé er færdige.",
    timing: "event",
    locked: false,
    optIn: false,
    sensitive: false,
    audiences: ["CUSTOMER", "ADVISORS", "BOTH"],
    variables: MEETING,
  },
  board_changed: {
    key: "board_changed",
    label: "Board ændret",
    group: "Abonnement og board",
    description: "Sendes, når kundens faste board er ændret (af kunden eller admin).",
    timing: "event",
    locked: false,
    optIn: false,
    sensitive: false,
    audiences: ["CUSTOMER", "ADVISORS", "BOTH"],
    variables: [...COMMON, "virksomhed", "rådgivere", "ændring", "kontolink"],
    audienceNote: "«Rådgivere» er de berørte rådgivere: dem, der er kommet til, og dem, der er udgået.",
  },
  payment_failed: {
    key: "payment_failed",
    label: "Betaling mislykkedes",
    group: "Abonnement og board",
    description: "Sendes, når en betaling fejler. Stopper, hvis abonnementet ikke længere mangler betaling.",
    timing: "event",
    locked: false,
    optIn: false,
    sensitive: false,
    audiences: ["CUSTOMER"],
    variables: [...COMMON, "virksomhed", "kontolink"],
  },
  onboarding_abandoned: {
    key: "onboarding_abandoned",
    label: "Tilmelding ikke gjort færdig",
    group: "Onboarding",
    description:
      "Sendes en tid efter sidste aktivitet i en ufærdig tilmelding, og kun til dem, der har givet samtykke i trin 1. Stopper, når tilmeldingen er gennemført eller udløbet.",
    timing: "after_activity",
    locked: false,
    optIn: true,
    sensitive: false,
    audiences: ["SUBJECT"],
    variables: [...COMMON, "onboardinglink"],
  },
  advisor_invited: {
    key: "advisor_invited",
    label: "Rådgiver inviteret",
    group: "Konto",
    description: "Invitation med link til at vælge adgangskode. Transaktionel: kan ikke slås fra.",
    timing: "event",
    locked: true,
    optIn: false,
    sensitive: true,
    audiences: ["SUBJECT"],
    variables: [...COMMON, "invitationslink"],
  },
  password_reset: {
    key: "password_reset",
    label: "Nulstilling af adgangskode",
    group: "Konto",
    description: "Link til at vælge ny adgangskode. Transaktionel: kan ikke slås fra.",
    timing: "event",
    locked: true,
    optIn: false,
    sensitive: true,
    audiences: ["SUBJECT"],
    variables: [...COMMON, "nulstillingslink"],
  },
  account_exists: {
    key: "account_exists",
    label: "Konto findes allerede",
    group: "Konto",
    description:
      "Sendes, når nogen starter en tilmelding med en e-mail, der allerede har en konto (højst én gang i døgnet). Siden viser ingen forskel, så det ikke kan ses, om en e-mail er kunde. Transaktionel: kan ikke slås fra.",
    timing: "event",
    locked: true,
    optIn: false,
    sensitive: false,
    audiences: ["SUBJECT"],
    variables: [...COMMON, "loginlink", "nulstillingsside"],
  },
};

export const TRIGGER_GROUPS: TriggerGroup[] = ["Møder", "Abonnement og board", "Onboarding", "Konto"];

export function isTriggerKey(v: string): v is TriggerKey {
  return (TRIGGER_KEYS as readonly string[]).includes(v);
}

export const AUDIENCE_LABEL: Record<NotificationAudience, string> = {
  CUSTOMER: "Kunden",
  ADVISORS: "Rådgiverne",
  BOTH: "Kunden og rådgiverne",
  SUBJECT: "Personen selv",
};

export const CHANNEL_LABEL: Record<NotificationChannel, string> = { EMAIL: "E-mail", SMS: "SMS" };

/** Alle variabler med forklaring og eksempelværdi (til CMS-chips og forhåndsvisning). */
export const VARIABLES: Record<string, { label: string; sample: string }> = {
  fornavn: { label: "Modtagerens fornavn", sample: "Mette" },
  navn: { label: "Modtagerens fulde navn", sample: "Mette Lindberg" },
  virksomhed: { label: "Kundens virksomhed", sample: "Demo ApS" },
  mødedato: { label: "Mødedato (lang)", sample: "torsdag 12. november 2026" },
  mødedato_kort: { label: "Mødedato (kort, til SMS)", sample: "tor. 12. nov." },
  mødetid: { label: "Mødets starttidspunkt", sample: "10:00" },
  rådgivere: { label: "Rådgivernes navne", sample: "Louise Vestergaard, Jesper Holm Andersen og Søren Bjerregaard" },
  mødelink: { label: "Link til mødesiden", sample: "{APP}/meetings/eksempel" },
  ændring: { label: "Beskrivelse af ændringen (tilpasset modtageren)", sample: "Jesper Holm Andersen er udgået, og Camilla Strøm Nielsen deltager i stedet." },
  ny_rådgiver: { label: "Tilføjet rådgiver", sample: "Camilla Strøm Nielsen" },
  fjernet_rådgiver: { label: "Fjernet rådgiver", sample: "Jesper Holm Andersen" },
  kontolink: { label: "Link til modtagerens side", sample: "{APP}/account/subscription" },
  onboardinglink: { label: "Link til at fortsætte tilmeldingen", sample: "{APP}/kom-i-gang" },
  invitationslink: { label: "Link til at vælge adgangskode (invitation)", sample: "{APP}/set-password?token=…" },
  nulstillingslink: { label: "Link til at nulstille adgangskoden", sample: "{APP}/set-password?token=…&reset=1" },
  afmeldlink: { label: "Link til at afmelde beskeder", sample: "{APP}/afmeld?t=…" },
  loginlink: { label: "Link til login", sample: "{APP}/login" },
  nulstillingsside: { label: "Link til at bede om en ny adgangskode", sample: "{APP}/reset-password" },
};

export const KNOWN_VARIABLES = Object.keys(VARIABLES);
