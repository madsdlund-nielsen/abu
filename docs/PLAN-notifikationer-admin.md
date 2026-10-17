# Plan: mødeside, admin-styring af boards, notifikationer (inMobile)

## Ejerens beslutninger (17.10.2026)
1. Seedet testindhold og rådgiverpriser er fine som udgangspunkt.
2. Manuelt indtastede virksomheder: **løsning a** – ingen godkendelse kræves. Admin ser dem markeret «ikke verificeret» og kan filtrere på det (Admin → Kunder).
3. Admin skal kunne ændre både den faste board-opstilling og deltagere i det enkelte møde (pludseligt frafald).
4. Betaling: afklares senere. Alunta (dansk abonnementsstyring) undersøges. Betalingsadapteren bevares, og der bygges ikke noget nyt nu.
5. CVR: "gratis og nemt" → cvrapi.dk som standard i produktion (ingen ansøgning). virk-adapteren bevares som alternativ.
6. E-mail og SMS via inMobile (dansk). Tekster, frekvenser og triggere styres i CMS'en.

### Tillæg (ejerens beslutninger, samme dag)
7. **Onboarding trin 1 er en standard lead-boks.** Afkrydsningen er et generelt samtykke til fremtidig kontakt (ikke kun «ufærdig tilmelding»), aldrig forudkrydset: «Ja tak, I må gerne kontakte mig på e-mail og SMS med opfølgning og relevante tilbud fra Advisory Board Unlimited. Jeg kan altid trække samtykket tilbage.» Det gemmes som en rigtig samtykkepost (`MarketingConsent`: tidspunkt, kanaler, den ordrette tekst + version, kilde `onboarding_trin1`, IP/user-agent, tilbagetrukket-tidspunkt). Leadet (`Lead`: navn, e-mail, samtykke) gemmes, så snart trin 1 er sendt, også hvis tilmeldingen aldrig gøres færdig. Admin får en liste over leads (`/admin/leads`) med trin nået, seneste aktivitet og samtykkestatus samt filter og CSV-eksport. `onboarding_abandoned` og alle fremtidige markedsføringsudsendelser kræver samtykket; transaktionelle beskeder gør ikke. Tilbagetrækning sker via afmeldingslinket og under kundens Konto. Leads uden samtykke og uden gennemførelse slettes, når sessionen udløber; leads med samtykke gemmes, til samtykket trækkes tilbage eller opbevaringsperioden (standard 24 mdr., kan ændres i CMS) er gået.
8. **Alle tekster i onboarding kan redigeres i CMS'en** (`/admin/onboarding/tekster`): titler, over-titler, introduktioner, feltnavne, eksempeltekster, hjælpetekster, knapper, fejl- og tomtilstande (fx CVR ikke fundet / ophørt / kvote), samtykketeksten (ændring hæver versionen), board-builder-tekster og trin 6's vilkårs- og samtykketekst. Standardtekster ligger i koden, og ændringer gemmes som `ContentBlock`; manglende nøgler falder tilbage til standarden. Hver tekst vises i kontekst i en lille forhåndsvisning af trinnet, med gendan-standard og letvægts-markdown (**fed**, [link](/sti)). Alle ændringer audit-logges.

## 1. Mødeside
- Samtykket til optagelse og transskription gives, når kontoen oprettes, og indgår i aftalen. Der er ingen accept-gate på mødesiden. Rummet vises direkte for deltagere, når det er relevant, med en lille informationslinje ("Mødet optages og transskriberes automatisk").
- Kundens konto (onboarding trin 6): det eksplicitte samtykke til optagelse og transskription står i vilkårs-checkboxen eller som separat afkrydsning. Det gemmes i `User.recordingConsentAt` (eller som felt i eksisterende `consentAt` + version).
- Rådgivere: samme accept på /set-password (invitation), gemt på samme måde. Eksisterende brugere uden registreret samtykke får en engangs-accept ved næste login (en lille side). Indtil da er "Deltag" blokeret med en forklaring.
- "Deltag i mødet" og mødelokalet vises kun i et tidsvindue: fra 15 min før start (`MEETING_JOIN_EARLY_MINUTES`) til mødets slut. Før vinduet vises en nedtælling/"Åbner kl. HH:MM". Efter slut, eller hvis mødet er COMPLETED/CANCELLED, er der ingen deltag-knap. Afholdte møder viser "Afholdt" + transskription/resumé, eller "Transskription behandles", og aflyste møder viser "Aflyst".
- Ren funktion `meetingJoinState(meeting, now)` → `"not_open_yet" | "open" | "ended" | "cancelled"` med tests (inkl. sommertid).
- Opdatér privatliv/vilkår-skabelonerne med afsnittet om optagelse og transskription.

## 2. Admin: boards og enkeltmøder
**Fast board** (/admin/subscriptions/[id] eller /admin/customers/[id]):
- Brug board-builder-komponenten i admin-tilstand. Admin kan udskifte, tilføje og fjerne rådgivere (2–4).
- Valg ved prisændring: "behold nuværende pris" eller "genberegn efter nye rådgiveres priser" (fra næste betalingsperiode, med opdatering via betalingsadapteren).
- Kommende møder: valgfrit "opdatér også kommende møder", som udskifter rådgiveren i fremtidige BOOKED møder, hvis den nye rådgiver er ledig (ellers listes konflikter).
- Notifikation til kunde og berørte rådgivere (trigger `board_changed`).

**Enkeltmøde** (/admin/meetings/[id]):
- "Udskift rådgiver" for dette ene møde. Viser kandidater sorteret efter (a) ledig på tidspunktet, (b) tag-match med kundens behov, (c) pris. Ledighed tjekkes med samme logik som booking (låsning/transaktion).
- Tilføj/fjern en ekstra deltager. Minimum 1 rådgiver, og der advares, hvis antallet er under boardets.
- Valgfri intern note ("Frafald pga. sygdom").
- Prisen for kunden er uændret, fordi abonnementet dækker. Rådgiverhonorering registreres pr. faktisk deltager (`MeetingParticipant`), så afregning senere følger de reelle deltagere.
- Video: den nye rådgiver får host-adgang. Mock opdaterer direkte, og Whereby genbruger rummet (hostRoomUrl deles).
- Notifikationer: `meeting_participant_changed` til kunde, ny rådgiver og fjernet rådgiver.
- Alt audit-logges.
- Admin kan også flytte et møde (nyt tidspunkt med ledighedstjek) og aflyse på kundens vegne (trigger `meeting_rescheduled`/`meeting_cancelled`).

## 3. Notifikationer
### Udsendelse (adapter `src/lib/messaging/`)
- `EMAIL_PROVIDER=console|smtp|inmobile`, `SMS_PROVIDER=console|inmobile`.
- inMobile API v4 (basic auth med API-nøgle, `INMOBILE_API_KEY`):
  - SMS: `POST https://api.inmobile.com/v4/sms/outgoing` med `messages[{to, text, from, countryHint:"45", messageId, statusCallbackUrl}]`.
  - E-mail: inMobiles e-mail-API `POST https://api.inmobile.com/v4/email/outgoing` med from/to/subject/html/text.
  - Feltnavne skrives efter bedste viden og markeres "verificér" i OPEN_ITEMS.
  - Statuswebhook `/api/webhooks/inmobile` (delivered/failed) opdaterer loggen.
- Afsendernavn til SMS: `SMS_SENDER` (maks. 11 tegn, f.eks. "ABUnlimited").
- Telefonnumre normaliseres til E.164. Rådgivere får et telefonfelt på profilen.

### Datamodel
- `NotificationTemplate(id, key, channel EMAIL|SMS, name, subject?, body, active, updatedAt)`. Body bruger simple variabler `{{fornavn}}`, `{{virksomhed}}`, `{{mødedato}}`, `{{mødetid}}`, `{{rådgivere}}`, `{{mødelink}}`, `{{onboardinglink}}`, `{{afmeldlink}}` osv. Ukendte variabler giver en valideringsfejl i CMS.
- `NotificationRule(id, trigger, offsetMinutes, channel, templateId, audience CUSTOMER|ADVISORS|BOTH, active, quietHours bool)`, f.eks. `meeting_reminder` med offset -1440 (24 t før) og -60.
- `NotificationLog(id, ruleId?, templateKey, channel, recipientUserId?, recipientAddress, entityType, entityId, status QUEUED|SENT|DELIVERED|FAILED|SKIPPED, providerMessageId, error, scheduledFor, sentAt)` med unik nøgle (ruleId, entityId, recipient) for idempotens.

### Triggere
- **Møder:** `meeting_booked`, `meeting_reminder` (offset før start), `meeting_rescheduled`, `meeting_cancelled`, `meeting_participant_changed`, `transcript_ready`.
- **Abonnement og board:** `board_changed`, `payment_failed`.
- **Onboarding:** `onboarding_abandoned`. Offset efter sidste aktivitet i en uafsluttet OnboardingSession, f.eks. +60 min, +24 t og +72 t. Stopper, når onboardingen er gennemført eller sessionen er udløbet.
- **Konto:** `advisor_invited`, `password_reset`. De to er transaktionelle og kan ikke slås fra, men teksten kan redigeres.

### Planlægning
- Job-processoren kører hvert minut via cron-ruten/in-process og finder forfaldne regler. Hændelsesbaserede triggere afsendes med det samme (offset 0) eller planlægges.
- Ændres et mødetidspunkt, genberegnes påmindelserne, og aflyste møder annullerer køen.
- Stille timer for SMS (`SMS_QUIET_HOURS=21-08`, kan ændres i CMS): udsættes til næste tilladte tidspunkt, undtagen påmindelser under 2 timer før mødet.

### Samtykke (markedsføringsloven/GDPR)
- Påmindelser og andre transaktionelle beskeder om en aftalt ydelse kræver ikke markedsføringssamtykke.
- `onboarding_abandoned` sendes til en person, der endnu ikke er kunde, og kræver derfor aktivt samtykke (se tillæg 7: generelt markedsføringssamtykke i trin 1, ikke forudkrydset). Uden samtykke sendes intet.
- Alle ikke-transaktionelle e-mails har afmeldingslink, og SMS'er har "Afmeld: svar STOP" eller et link. Afmelding gemmes og respekteres.

### CMS (/admin/notifikationer), samme on-brand kvalitet som onboarding-CMS'en
- Oversigt pr. trigger med regler (kanal, timing som "24 timer før mødet", modtager, aktiv-toggle).
- Opret, rediger og slet regler med en menneskelig timing-vælger (antal + enhed + før/efter).
- Skabeloneditor:
  - Emne og brødtekst med variabel-indsætter (chips), live preview med eksempeldata og SMS-tegntæller med antal SMS-dele (GSM-7 vs. UCS-2, æøå er GSM-7).
  - "Send test til mig" (e-mail/SMS).
  - E-mails renderes i et simpelt, brandet HTML-layout (logo, navy/charcoal, Open Sans-fallback) plus tekstversion.
- Log-visning: seneste udsendelser med status, filtrering og "send igen" ved fejl.
- Indstillinger: stille timer og SMS-afsendernavn.
- Seed fornuftige danske standardtekster for alle triggere.

## 4. cvrapi.dk som standard
- `CVR_PROVIDER` er standard `cvrapi` i `.env.example` til produktion (mock lokalt), og README forklarer gratis-kvoten.
- Cache 24 t (findes). Der vises en pæn fejl ved kvote-overskridelse, og kunden kan fortsætte manuelt.

## 5. Kvalitet
- Lint, typecheck, test og build skal gå igennem.
- Tests:
  - `meetingJoinState`.
  - Notifikationsplanlægning: offsets, stille timer, idempotens, aflysning og genberegning.
  - Template-rendering og validering, SMS-segmenttælling.
  - Kandidatsortering ved udskiftning.
- Playwright:
  - Mødesiden i de tre tilstande.
  - Admin udskifter en rådgiver i et enkeltmøde og i det faste board.
  - CMS: ret en SMS-tekst, se preview og send test (konsol-adapter), og verificér at loggen viser den.
  - En booking udløser bekræftelse og planlagte påmindelser.
- Skærmbilleder i `docs/screens/` (nye undermapper eller filer) og README.

## 6. Manuelt indtastede virksomheder (afklaret: løsning a)
Ingen godkendelse kræves. Admin ser dem markeret «ikke verificeret» og kan filtrere på det i kundelisten.

## 7. Leads og markedsføringssamtykke (tillæg 7)
- Datamodel: `Lead(email unique, name, phone, step, lastActivityAt, convertedAt)`, `MarketingConsent(leadId?, userId?, email, phone?, emailConsent, smsConsent, consentedAt, text, textVersion, source, ipAddress, userAgent, emailWithdrawnAt, smsWithdrawnAt)`, `OnboardingSession.leadId`.
- `/admin/leads`: filtre (status, samtykke, søg) og CSV-eksport (`/api/admin/leads`, audit-logges).
- Opbevaring: dagligt job `cleanup_leads` (se §3 Samtykke). Eksport og sletning af konto omfatter leads og samtykker.

## 8. Redigerbare onboarding-tekster (tillæg 8)
- `ContentBlock(key, value, version, updatedAt, updatedById)`; typede standarder i `src/lib/content/onboarding-texts.ts`.
- Samtykketeksternes version (`m<n>` for markedsføring, `r<n>` for optagelse) følger `ContentBlock.version`.
- Tests: fallback til standard, validering af pladsholdere/links, rich-text.
