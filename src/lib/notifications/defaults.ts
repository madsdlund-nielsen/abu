import type { NotificationAudience, NotificationChannel } from "@prisma/client";
import type { TriggerKey } from "./triggers";

/** Standardtekster og -regler (dansk). Seedes af prisma/seed.ts og kan genindlæses i CMS'et. */
export interface DefaultTemplate {
  key: string;
  channel: NotificationChannel;
  name: string;
  subject?: string;
  body: string;
}

export interface DefaultRule {
  trigger: TriggerKey;
  offsetMinutes: number;
  channel: NotificationChannel;
  templateKey: string;
  audience: NotificationAudience;
  quietHours?: boolean;
}

const SIGN = "Venlig hilsen\nAdvisory Board Unlimited";

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: "meeting_booked_customer_email",
    channel: "EMAIL",
    name: "Møde booket – kunde (e-mail)",
    subject: "Dit møde er booket: {{mødedato}} kl. {{mødetid}}",
    body: `Hej {{fornavn}}

Dit møde er booket {{mødedato}} kl. {{mødetid}}.

Rådgivere: {{rådgivere}}

Mødet optages og transskriberes automatisk. Du deltager via mødesiden, som åbner kort før start:
{{mødelink}}

${SIGN}`,
  },
  {
    key: "meeting_booked_advisor_email",
    channel: "EMAIL",
    name: "Møde booket – rådgiver (e-mail)",
    subject: "Nyt møde: {{virksomhed}}, {{mødedato}} kl. {{mødetid}}",
    body: `Hej {{fornavn}}

Der er booket et møde med {{virksomhed}} {{mødedato}} kl. {{mødetid}}.

Rådgivere: {{rådgivere}}

Mødet optages og transskriberes automatisk. Mødesiden åbner kort før start:
{{mødelink}}

${SIGN}`,
  },
  {
    key: "meeting_reminder_email",
    channel: "EMAIL",
    name: "Påmindelse om møde (e-mail)",
    subject: "Påmindelse: møde {{mødedato}} kl. {{mødetid}}",
    body: `Hej {{fornavn}}

Husk mødet med {{virksomhed}} {{mødedato}} kl. {{mødetid}}.

Rådgivere: {{rådgivere}}

Du deltager via mødesiden, som åbner kort før start:
{{mødelink}}

${SIGN}`,
  },
  {
    key: "meeting_reminder_sms",
    channel: "SMS",
    name: "Påmindelse om møde (SMS)",
    body: "ABU: Påmindelse om møde {{mødedato_kort}} kl. {{mødetid}}. Deltag: {{mødelink}}",
  },
  {
    key: "meeting_rescheduled_email",
    channel: "EMAIL",
    name: "Møde flyttet (e-mail)",
    subject: "Mødet er flyttet til {{mødedato}} kl. {{mødetid}}",
    body: `Hej {{fornavn}}

Mødet med {{virksomhed}} er flyttet. Det nye tidspunkt er {{mødedato}} kl. {{mødetid}}.

Rådgivere: {{rådgivere}}

Se mødet:
{{mødelink}}

${SIGN}`,
  },
  {
    key: "meeting_rescheduled_sms",
    channel: "SMS",
    name: "Møde flyttet (SMS)",
    body: "ABU: Mødet er flyttet til {{mødedato_kort}} kl. {{mødetid}}. {{mødelink}}",
  },
  {
    key: "meeting_cancelled_email",
    channel: "EMAIL",
    name: "Møde aflyst (e-mail)",
    subject: "Mødet {{mødedato}} er aflyst",
    body: `Hej {{fornavn}}

Mødet med {{virksomhed}} {{mødedato}} kl. {{mødetid}} er aflyst.

Du kan se mødet her:
{{mødelink}}

${SIGN}`,
  },
  {
    key: "meeting_cancelled_sms",
    channel: "SMS",
    name: "Møde aflyst (SMS)",
    body: "ABU: Mødet {{mødedato_kort}} kl. {{mødetid}} er aflyst.",
  },
  {
    key: "meeting_participant_changed_customer_email",
    channel: "EMAIL",
    name: "Deltagere ændret – kunde (e-mail)",
    subject: "Ændring i deltagere til mødet {{mødedato_kort}}",
    body: `Hej {{fornavn}}

Der er sket en ændring i deltagerne til mødet {{mødedato}} kl. {{mødetid}}.

{{ændring}}

Rådgivere ved mødet: {{rådgivere}}

Prisen er uændret, fordi dit abonnement dækker mødet.

Se mødet:
{{mødelink}}

${SIGN}`,
  },
  {
    key: "meeting_participant_changed_advisor_email",
    channel: "EMAIL",
    name: "Deltagere ændret – berørt rådgiver (e-mail)",
    subject: "Ændring af dit møde {{mødedato_kort}}",
    body: `Hej {{fornavn}}

{{ændring}}

Møde: {{virksomhed}}, {{mødedato}} kl. {{mødetid}}
Rådgivere ved mødet: {{rådgivere}}

{{mødelink}}

${SIGN}`,
  },
  {
    key: "transcript_ready_email",
    channel: "EMAIL",
    name: "Transskription og resumé klar (e-mail)",
    subject: "Resumé og transskription er klar",
    body: `Hej {{fornavn}}

Resumé og transskription fra mødet {{mødedato}} er klar. Du finder dem på mødesiden:
{{mødelink}}

${SIGN}`,
  },
  {
    key: "board_changed_customer_email",
    channel: "EMAIL",
    name: "Board ændret – kunde (e-mail)",
    subject: "Dit board er ændret",
    body: `Hej {{fornavn}}

Boardet hos {{virksomhed}} er ændret.

{{ændring}}

Dit board består nu af: {{rådgivere}}

Se dit abonnement:
{{kontolink}}

${SIGN}`,
  },
  {
    key: "board_changed_advisor_email",
    channel: "EMAIL",
    name: "Board ændret – berørt rådgiver (e-mail)",
    subject: "Ændring af board hos {{virksomhed}}",
    body: `Hej {{fornavn}}

{{ændring}}

Kunde: {{virksomhed}}

Se dit overblik:
{{kontolink}}

${SIGN}`,
  },
  {
    key: "payment_failed_email",
    channel: "EMAIL",
    name: "Betaling mislykkedes (e-mail)",
    subject: "Din betaling mislykkedes",
    body: `Hej {{fornavn}}

Vi kunne ikke gennemføre den seneste betaling for {{virksomhed}}. Opdatér dit betalingskort, så du fortsat kan booke møder.

Gå til dit abonnement:
{{kontolink}}

${SIGN}`,
  },
  {
    key: "payment_failed_reminder_email",
    channel: "EMAIL",
    name: "Betaling mangler – påmindelse (e-mail)",
    subject: "Påmindelse: din betaling mangler",
    body: `Hej {{fornavn}}

Betalingen for {{virksomhed}} er stadig ikke gået igennem. Så længe den mangler, kan du ikke booke nye møder.

Opdatér dit betalingskort her:
{{kontolink}}

${SIGN}`,
  },
  {
    key: "onboarding_abandoned_1_email",
    channel: "EMAIL",
    name: "Tilmelding ikke færdig – første (e-mail)",
    subject: "Din tilmelding venter",
    body: `Hej {{fornavn}}

Du er godt på vej til at sammensætte dit advisory board. Din tilmelding er gemt, så du kan fortsætte, hvor du slap:
{{onboardinglink}}

${SIGN}`,
  },
  {
    key: "onboarding_abandoned_2_email",
    channel: "EMAIL",
    name: "Tilmelding ikke færdig – anden (e-mail)",
    subject: "Dit board er næsten klar",
    body: `Hej {{fornavn}}

Det tager kun få minutter at gøre tilmeldingen færdig og få dit forslag til et board. Fortsæt her:
{{onboardinglink}}

${SIGN}`,
  },
  {
    key: "onboarding_abandoned_sms",
    channel: "SMS",
    name: "Tilmelding ikke færdig (SMS)",
    body: "ABU: Din tilmelding venter stadig. Fortsæt her: {{onboardinglink}}",
  },
  {
    key: "advisor_invited_email",
    channel: "EMAIL",
    name: "Invitation til rådgiver (e-mail)",
    subject: "Du er inviteret til Advisory Board Unlimited",
    body: `Hej {{fornavn}}

Du er oprettet som rådgiver hos Advisory Board Unlimited. Vælg en adgangskode via linket (gyldigt i 7 dage):
{{invitationslink}}

${SIGN}`,
  },
  {
    key: "password_reset_email",
    channel: "EMAIL",
    name: "Nulstil adgangskode (e-mail)",
    subject: "Nulstil din adgangskode",
    body: `Hej {{fornavn}}

Brug linket herunder til at vælge en ny adgangskode (gyldigt i 2 timer). Hvis du ikke har bedt om det, kan du ignorere mailen.

{{nulstillingslink}}

${SIGN}`,
  },
  {
    key: "account_exists_email",
    channel: "EMAIL",
    name: "Konto findes allerede (e-mail)",
    subject: "Du har allerede en konto hos Advisory Board Unlimited",
    body: `Hej {{fornavn}}

Nogen – forhåbentlig dig – er begyndt at oprette en konto med denne e-mailadresse. Du har allerede en konto, så du kan bare logge ind:

{{loginlink}}

Har du glemt adgangskoden, kan du få en ny her: {{nulstillingsside}}

Var det ikke dig, kan du se bort fra denne e-mail. Der er ikke ændret noget på din konto.

${SIGN}`,
  },
];

export const DEFAULT_RULES: DefaultRule[] = [
  { trigger: "meeting_booked", offsetMinutes: 0, channel: "EMAIL", templateKey: "meeting_booked_customer_email", audience: "CUSTOMER" },
  { trigger: "meeting_booked", offsetMinutes: 0, channel: "EMAIL", templateKey: "meeting_booked_advisor_email", audience: "ADVISORS" },
  { trigger: "meeting_reminder", offsetMinutes: -1440, channel: "EMAIL", templateKey: "meeting_reminder_email", audience: "BOTH" },
  { trigger: "meeting_reminder", offsetMinutes: -60, channel: "SMS", templateKey: "meeting_reminder_sms", audience: "BOTH", quietHours: true },
  { trigger: "meeting_rescheduled", offsetMinutes: 0, channel: "EMAIL", templateKey: "meeting_rescheduled_email", audience: "BOTH" },
  { trigger: "meeting_rescheduled", offsetMinutes: 0, channel: "SMS", templateKey: "meeting_rescheduled_sms", audience: "BOTH", quietHours: true },
  { trigger: "meeting_cancelled", offsetMinutes: 0, channel: "EMAIL", templateKey: "meeting_cancelled_email", audience: "BOTH" },
  { trigger: "meeting_cancelled", offsetMinutes: 0, channel: "SMS", templateKey: "meeting_cancelled_sms", audience: "BOTH", quietHours: true },
  { trigger: "meeting_participant_changed", offsetMinutes: 0, channel: "EMAIL", templateKey: "meeting_participant_changed_customer_email", audience: "CUSTOMER" },
  { trigger: "meeting_participant_changed", offsetMinutes: 0, channel: "EMAIL", templateKey: "meeting_participant_changed_advisor_email", audience: "ADVISORS" },
  { trigger: "transcript_ready", offsetMinutes: 0, channel: "EMAIL", templateKey: "transcript_ready_email", audience: "BOTH" },
  { trigger: "board_changed", offsetMinutes: 0, channel: "EMAIL", templateKey: "board_changed_customer_email", audience: "CUSTOMER" },
  { trigger: "board_changed", offsetMinutes: 0, channel: "EMAIL", templateKey: "board_changed_advisor_email", audience: "ADVISORS" },
  { trigger: "payment_failed", offsetMinutes: 0, channel: "EMAIL", templateKey: "payment_failed_email", audience: "CUSTOMER" },
  { trigger: "payment_failed", offsetMinutes: 4320, channel: "EMAIL", templateKey: "payment_failed_reminder_email", audience: "CUSTOMER" },
  { trigger: "onboarding_abandoned", offsetMinutes: 60, channel: "EMAIL", templateKey: "onboarding_abandoned_1_email", audience: "SUBJECT" },
  { trigger: "onboarding_abandoned", offsetMinutes: 1440, channel: "EMAIL", templateKey: "onboarding_abandoned_2_email", audience: "SUBJECT" },
  { trigger: "onboarding_abandoned", offsetMinutes: 4320, channel: "SMS", templateKey: "onboarding_abandoned_sms", audience: "SUBJECT", quietHours: true },
  { trigger: "advisor_invited", offsetMinutes: 0, channel: "EMAIL", templateKey: "advisor_invited_email", audience: "SUBJECT" },
  { trigger: "password_reset", offsetMinutes: 0, channel: "EMAIL", templateKey: "password_reset_email", audience: "SUBJECT" },
  { trigger: "account_exists", offsetMinutes: 0, channel: "EMAIL", templateKey: "account_exists_email", audience: "SUBJECT" },
];
