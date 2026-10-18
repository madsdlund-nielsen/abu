# Advisory Board Unlimited (ABU)

Advisory board som abonnement. Kunder vælger 2, 3 eller 4 rådgivere og en mødefrekvens (hver 4., 8. eller 12. uge),
betaler en fast månedspris, booker møder online og får transskription og resumé af hvert møde bagefter.

- Prisformel: `sum(rådgivernes mødepris) × (52 / uger) / 12`, afrundet til hele kroner (ekskl. moms, bekræftet af ejer). Hver rådgiver har sin
  egen mødepris (standard 1.750 kr., sat af admin) – se `src/lib/pricing.ts`. Prisen fastfryses på abonnementet ved køb.
- Roller: **Admin** (opretter rådgivere, priser, tags, onboarding-test, ser alt), **Rådgiver** (profil, tilgængelighed, møder), **Kunde** (onboarding, abonnement, booking, møder).
- Nye kunder starter i en onboarding med CVR-opslag og en kort test, der foreslår et board (se *Onboarding og CMS* nedenfor).
- UI på dansk. Kun europæiske leverandører, ingen tracking, ingen eksterne fonte/CDN'er.

## Hurtig start (lokalt, uden eksterne konti)

Forudsætninger: Node 22, npm 10 og en Postgres 16 (fx via Docker).

```bash
docker run -d --name abu-pg -e POSTGRES_PASSWORD=abu -e POSTGRES_USER=abu -e POSTGRES_DB=abu -p 5432:5432 postgres:16

cp .env.example .env          # alle integrationer er "mock" som standard
npm install
npx prisma migrate deploy     # opretter tabellerne
npm run db:seed               # demodata
npm run dev                   # http://localhost:3000
```

Seed-brugere:

| Rolle | Login | Adgangskode |
|---|---|---|
| Admin | `admin@abu.local` | `Admin12345!` |
| Kunde (aktivt abonnement: 3 rådgivere, hver 8. uge) | `kunde@abu.local` | `Kunde12345!` |
| Rådgivere (8 stk., fx `mette.lindberg@abu.local`) | se `prisma/seed-data.ts` | `Raadgiver123!` |

Seed opretter også danske standardtekster og -regler til notifikationer (23 skabeloner, 23 regler), og fire rådgivere får det interne tag «Lead-kvalificeret».

Hele flowet virker i mock-tilstand: onboarding (`/kom-i-gang`) → testbetaling (`/subscribe/mock-betaling`, ét klik) → book → åbn
mødet → upload optagelse (som rådgiver/admin) → transskription og resumé vises på mødesiden. Mails og SMS skrives **redigeret**
til serverloggen (links uden tokens, maskerede adresser og numre); beskeder med engangslinks (invitation, nulstilling) logges
slet ikke. Invitationslinket vises i stedet for admin i UI'et, når e-mail kører i konsol-tilstand.

Stakken er Next.js 16 (App Router, `src/proxy.ts`), React 19 og Prisma 7 med driver-adapteren `@prisma/adapter-pg`
(forbindelsen konfigureres i `prisma.config.ts`; Prisma læser ikke længere `.env` af sig selv – det gør `prisma.config.ts`).
Alle versioner er låst i `package.json`; installér med `npm ci`.
Billedbehandlingen bruger `sharp` (open source, libvips) med en fast version; `npm ci` henter den færdigbyggede binær til
platformen (`@img/sharp-linux-x64` + libvips på `node:22-bookworm-slim` og i CI), så der skal ikke installeres systempakker.

Seed er **kun til udvikling**: det afvises, når `NODE_ENV=production` eller `APP_ENV=production` (H-1).

Med Docker Compose (Postgres + migration + app) lokalt:

```bash
cp .env.example .env          # sæt APP_ENV=development i .env for at køre lokalt med mock-udbydere
docker compose up --build
docker compose run --rm -e APP_ENV=development migrate npx tsx prisma/seed.ts   # valgfrit: demodata (kun lokalt)
```

### Scripts

| Kommando | Formål |
|---|---|
| `npm run dev` | Udviklingsserver |
| `npm run build` / `npm start` | Produktionsbuild (Next `standalone`) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Enheds- og integrationstests (vitest). DB-tests kører kun med `TEST_DATABASE_URL` (en separat testdatabase, migreret med `prisma migrate deploy`); ellers springes de over |
| `npm run db:migrate` | Ny migration under udvikling |
| `npm run db:deploy` | Anvend migrationer (produktion) |
| `npm run db:seed` | Seed-data (kun udvikling; afvises i produktion) |
| `npm run create-admin -- --email … --name …` | Opretter første administrator og udskriver et engangslink til at vælge adgangskode |
| `npm run storage:check` | Tjekker objektlageret med appens konfiguration: skriver, læser og sletter et testobjekt; med S3 også privat bucket og CORS (se `docs/HETZNER-S3.md`) |

## Onboarding og CMS

**Flow (`/kom-i-gang`, `/signup` omdirigerer hertil).** Seks trin med trinindikator: 1 Kontakt · 2 Virksomhed (CVR + telefon) · 3 Bekræft
(CVR-opslag; ophørt/fejl vises tydeligt, manuel indtastning markeres «ikke verificeret») · 4 Test (ét spørgsmål pr. skærm) · 5 Dit board
(forslag, udskift/tilføj/fjern, frekvens, pris live) · 6 Konto & betaling (adgangskode, samtykke, resumé inkl. moms). Tilstanden gemmes server-side
i `OnboardingSession` (httpOnly-cookie, 7 dage; udløbne sessioner slettes af jobkøen). Først i trin 6 oprettes bruger, kundeprofil (CVR-data
og testsvar som snapshot) og et afventende abonnement, og kunden sendes til betaling. Efter betaling lander kunden på dashboardet, og sessionen slettes.
Eksisterende kunder ændrer board og frekvens under *Konto → Abonnement* med samme board-builder.

**Matching (`src/lib/matching.ts`, ren funktion).** Hvert svar har tag-vægte (1-5) og evt. `boardSize` (2/3/4). Kundens behov = sum af vægte pr. tag.
Rådgiverens score = sum af behov for hans kompetence-tags. Boardet vælges grådigt: højeste score først; tags boardet allerede dækker nedskrives til 30 % for de
næste valg (komplementaritet); lige score → laveste pris → alfabetisk. Størrelse: største `boardSize`, ellers tilføjes rådgivere til mindst 80 % af
behovet er dækket (2-4; standard 3 uden behov). Kun aktive rådgivere med mindst ét kompetence-tag tæller med. Har boardet ingen rådgiver, der kan være ansvarlig, erstattes medlemmet med det
mindste bidrag af den bedst scorende kvalificerede rådgiver.

*Eksempel (seed-data):* en kunde svarer «vækste hurtigere», «skalering», «nye markeder», mangler «salg og marketing» + «teknologi», 10-49 ansatte.
Behov: Vækst & salg 13, Marketing 7, Digitalisering 6, Ledelse 5, Internationalisering 5, Strategi 2, HR 2, Økonomistyring 1 (i alt 41).
Louise (score 26) vælges først; Jesper har basescore 18, men Vækst & salg er nu dækket (13 → 3,9), så hans effektive score er 8,9; efter to rådgivere er
dækningen 76 % (< 80 %), så Søren (Ledelse + HR = 7) tilføjes. Resultat: Louise, Jesper, Søren, dækning 93 %. Se `src/lib/matching.seed.test.ts`.

**CMS (admin).** `/admin/onboarding`: spørgsmålsliste (træk i grebet eller brug tastaturet til at sortere) og redigering af spørgsmål, svar, tag-vægter
(chips med vægt 1-5) og boardstørrelse; advarsler vises, hvor de gælder, og som sum øverst; *Forhåndsvis test* viser forslag, scores og begrundelse uden at
gemme noget. `/admin/tags`: kompetence-tags og interne admin-tags med brugstal, typefilter og inline omdøbning. `/admin/advisors/[id]`: status og aktivering, pris pr. møde, tags (interne i en separat gruppe) og profil. `/admin/customers/[id]`:
CVR-data og testsvar. Alle ændringer skrives til audit-loggen og gælder straks for nye onboardinger; gennemførte tests gemmer et snapshot af teksterne.

**CVR-opslag (`src/lib/cvr/`).** `CVR_PROVIDER=mock|virk|cvrapi` (standard `mock`: fiktive virksomheder; CVR `34000107` er ophørt, `35000100` findes ikke).
**I produktion bruges `cvrapi`** (cvrapi.dk: gratis og uden ansøgning, men med en begrænset daglig kvote; sæt en beskrivende `CVR_USER_AGENT`); ved opbrugt kvote vises en pæn besked, og kunden kan fortsætte med manuel indtastning. `virk` er Erhvervsstyrelsens «CVR-data – System til System» (gratis efter ansøgning; `CVR_VIRK_USERNAME`/`CVR_VIRK_PASSWORD`) og bevaret som alternativ. Manuelt indtastede virksomheder kræver ikke godkendelse, men markeres «ikke verificeret» (filter i Admin → Kunder). Opslag caches 24 timer og rate-limites pr. IP/session. Kontrol af CVR-nummeret (modulus 11) sker lokalt først.

## Mødeside, notifikationer og admin

**Mødeside (`/meetings/[id]`).** Samtykket til optagelse og transskription gives, når kontoen oprettes (kunder, trin 6) eller invitationen accepteres (rådgivere,
`/set-password`) og gemmes på brugeren (`recordingConsentAt`, versionen af teksten). Eksisterende brugere uden samtykke accepterer én gang ved næste login (`/samtykke`);
indtil da er mødelokalet blokeret med en forklaring. Der er ingen accept-gate på mødesiden, kun en informationslinje. Rummet vises kun i et tidsvindue:
fra `MEETING_JOIN_EARLY_MINUTES` (standard 15) før start til mødets slut, afgjort af den rene funktion `meetingJoinState(meeting, now)` (`src/lib/meeting-join.ts`) →
`not_open_yet` (nedtælling, «Åbner kl. HH:MM») · `open` · `ended` (afholdt + resumé/transskription, eller «Transskription behandles») · `cancelled`.

**Admin: boards og enkeltmøder.** `/admin/subscriptions/[id]` bruger board-builderen i admin-tilstand: udskift/tilføj/fjern rådgivere (2-4), vælg at beholde prisen eller genberegne
(nyt beløb sendes via betalingsadapteren, gælder fra næste betalingsperiode), og opdatér evt. kommende møder (ledighed tjekkes; konflikter vises). `/admin/meetings/[id]`: udskift rådgiver i ét møde
(kandidater sorteret efter ledighed, tag-match med kundens behov og pris; samme låsning som booking), tilføj/fjern ekstra deltager (minimum 1, advarsel under boardets størrelse), flyt mødet, aflys på
kundens vegne og se historikken. Honoraret registreres pr. faktisk deltager (`MeetingParticipant.pricePerMeetingDkk`). Alt audit-logges (inkl. intern note).

**Notifikationer (`src/lib/messaging/`, `src/lib/notifications/`).** Adaptere: `EMAIL_PROVIDER=console|smtp|inmobile`, `SMS_PROVIDER=console|inmobile` (inMobile v4 via almindelig `fetch`,
ingen SDK). Udløsere: møde booket/påmindelse/flyttet/aflyst/deltagere ændret/transskription klar, board ændret, betaling mislykkedes, tilmelding ikke gjort færdig, rådgiver inviteret og nulstilling
af adgangskode (de to sidste er transaktionelle og kan ikke slås fra). Regler (udløser + tidspunkt + kanal + modtager + skabelon) og tekster redigeres i **Admin → Notifikationer**:
regler med menneskelig timing-vælger («24 timer før mødets start»), skabeloneditor med variabel-chips, live preview, SMS-tegntæller (GSM-7/UCS-2), «Send test til mig», log med filtre og «Send igen»,
samt indstillinger (stille timer, SMS-afsendernavn, opbevaring). Jobkøen/in-process-planlæggeren (`IN_PROCESS_SCHEDULER`) kører hvert minut: forfaldne beskeder sendes, påmindelser genplanlægges ved flytning
og annulleres ved aflysning, SMS udsættes i stille timer (`SMS_QUIET_HOURS`, standard 21-08, undtagen påmindelser under 2 timer før mødet), og beskeder er idempotente (unik nøgle pr. regel/enhed/modtager).
E-mails er brandede HTML-mails med tekstversion.

**Leads og samtykke.** Onboarding trin 1 er en lead-boks: navn og e-mail gemmes straks (`Lead`), og et ikke-forudkrydset markedsføringssamtykke gemmes som `MarketingConsent` (ordret tekst, version, kilde, IP/user-agent,
tilbagetrækning). Uden samtykke kontaktes ingen, og leadet slettes, når tilmeldingen udløber; med samtykke gemmes det, til samtykket trækkes tilbage (afmeldingslink, STOP eller Konto) eller opbevaringsperioden
(`LEAD_RETENTION_MONTHS`, 24) er gået. **Admin → Leads** viser trin nået, seneste aktivitet og samtykke med filter og CSV-eksport. `onboarding_abandoned` og fremtidig markedsføring kræver samtykket.

**Redigerbare onboarding-tekster.** Alle tekster i tilmeldingen (titler, introer, feltnavne, knapper, fejl-/tomtilstande, samtykketekster, board-builder) redigeres under **Admin → Onboarding → Tekster** med forhåndsvisning pr. trin.
Standarder ligger i `src/lib/content/onboarding-texts.ts`; ændringer gemmes som `ContentBlock`. Ændring af en samtykketekst hæver versionen.

## Design

Visuelt design følger `docs/design/designmanual.pdf`. Tokens ligger i `src/styles/design-tokens.css` og spejles i `tailwind.config.ts`
(brug `bg-navy`, `text-gold-ink` osv., aldrig hex i komponenter).

**Kontrast (WCAG AA, ejerens beslutning 17.10.2026).** Primærknapper har charcoal tekst på guld (`--color-on-gold`, 5,57:1), eyebrows
på lyse flader er navy (`--color-eyebrow`), og guld som *tekst* på lyse flader bruger `--color-gold-ink` (#81693c, 5,22:1). Guld og
guld-mørk bruges fortsat til flader, streger og kanter. Pladsholdere og kommende trin bruger `--color-placeholder`. Målinger og
før/efter-skærmbilleder: `docs/legacy/v4-foer-produktion/screens/kontrast/`. Open Sans er selvhostet via `@fontsource/open-sans` (ingen Google Fonts).
Logoet er de officielle SVG-filer (`docs/design/logo/` er originalerne, `public/brand/` er webkopier uden C2PA-metadata) via komponenten `src/components/logo.tsx`. Skærmbilleder: `docs/screens/` (offentlig, onboarding, kunde, rådgiver, admin og mobil; mødeside, notifikations-CMS, board- og mødeadministration, leads og onboarding-tekster er nyest) og demo-video: `docs/demo/`. Ældre skærmbilleder og demoer ligger i `docs/legacy/`.

## Arkitektur

```
src/
  app/                 Next.js App Router (sider + server actions + API-ruter)
    (app)/             Indloggede sider: dashboard, subscribe, book, meetings, account, availability, profile
    admin/             Admin (kræver rollen ADMIN)
    api/webhooks/      payments (Frisbii) og video (Whereby)
    api/cron/          process-jobs (CRON_SECRET)
    kom-i-gang/        Onboarding (6 trin)
    actions/           Server actions (auth, onboarding, cms, subscription, meetings, advisor, admin, account)
  lib/
    pricing.ts         Prisformel (pr. rådgiver), moms, plan-handles
    matching.ts        Ren funktion: forslag til board ud fra testsvar og tags (testet)
    cvr/               CVR-opslag: mock, virk (Erhvervsstyrelsen), cvrapi.dk, modulus 11, cache
    onboarding/        Session, katalog, board-validering, snapshot, CMS-data og advarsler
    slots.ts           Ren funktion: ledige tider for et board (testet)
    quota.ts           Kvoteperioder, aflysningsregler (testet)
    booking.ts         Booking/aflysning med revalidering i DB-transaktion (advisory locks)
    auth.ts            Hashing (bcryptjs), DB-sessioner (SHA-256 af tilfældigt token), rate limit, invite/reset-tokens
    jobs.ts, pipeline.ts  DB-baseret jobkø (FOR UPDATE SKIP LOCKED) og transskriptions-pipeline
    payments/ video/ transcription/ messaging/ storage/   Adaptere med mock-implementering (messaging: e-mail + SMS, inMobile)
    avatar*.ts         Rådgiverfotos: validering, sharp-behandling, lagring, adgang og servering (/api/avatar)
    notifications/     Udløsere, regler, skabeloner, planlægning (ren), udsendelse, afmelding, log
    content/           Redigerbare onboarding-tekster (standarder + ContentBlock)
    meeting-join.ts, meeting-admin.ts, board-admin.ts, substitutes.ts, leads.ts   Mødevindue, admin-ændringer, leads
  proxy.ts             Letvægts-gate (kræver session-cookie, ?next= til login) + sikkerhedsheaders (CSP med nonce, HSTS,
                       Permissions-Policy); rollekontrol sker i layouts/sider
  instrumentation.ts   Fail-closed opstartstjek af konfigurationen (C-1) og planlæggeren
prisma/                schema, migrationer, seed
```

**Adaptere.** Hver integration har et interface og en `mock`-implementering, valgt via miljøvariabel:
`PAYMENT_PROVIDER`, `VIDEO_PROVIDER`, `TRANSCRIPTION_PROVIDER`, `EMAIL_PROVIDER`, `SMS_PROVIDER`, `STORAGE_PROVIDER`.
Eksterne API'er kaldes med almindelig `fetch` – ingen leverandør-SDK'er.

**Auth.** Ingen ekstern IdP. Adgangskoder hashes med bcrypt (cost 12). Sessioner ligger i databasen; cookien indeholder et
tilfældigt token, og databasen gemmer kun dets SHA-256. Cookien er `httpOnly`, `sameSite=lax` og altid `secure` i produktion.
Rådgivere inviteres af admin og vælger selv adgangskode via et engangslink (7 dage). Login spærres pr. konto i databasen efter
5 forkerte forsøg (15 min, derefter fordoblet, højst 24 t) uanset IP; derudover er der rate limits pr. betroet klient-IP
(`TRUSTED_PROXY_HOPS`). Alle rate limits ligger i Postgres-tabellen `RateLimit`, så de overlever genstart og deles mellem instanser.
Booking og «opret rådgiver» er idempotente (formular-nøgle), så dobbeltklik giver samme resultat.

**Rådgivere: aktivering og profil (`src/lib/advisor-activation.ts`, `advisor-readiness.ts`).** Rådgivere oprettes inaktive og aktiveres
manuelt af admin med en dedikeret knap («Aktivér rådgiver»/«Deaktivér rådgiver», egen server action, bekræftelse, audit-log). Aktivering
er **blokeret**, indtil tjeklisten er opfyldt: invitation accepteret, mindst ét kompetence-tag, ugentlig tilgængelighed, bio og en pris
inden for intervallet (standard 500-25.000 kr.). Serveren afviser også forfalskede requests med en dansk liste over det, der mangler.
Deaktivering er altid tilladt og viser de berørte kunders boards. En aktiv rådgiver, der senere ikke er klar, deaktiveres ikke automatisk,
men vises som «Aktiv – mangler: …». Statusbadget viser altid den gemte tilstand (AKTIV/INAKTIV). Admin kan rette rådgiverens titel, bio,
mobilnummer og profilbillede på `/admin/advisors/[id]` med samme validering som rådgiverens egen profil (audit-logget).
Tjeklisten viser også «Profilbillede (valgfrit)», men et foto er ikke et krav for aktivering.

**Rådgiverfotos (`src/lib/avatar.ts`, `avatar-url.ts`, `avatar-serve.ts`).** Rådgiveren (`/profile`) og admin
(`/admin/advisors/[id]`) uploader, skifter og fjerner profilbilledet (kvadratisk forhåndsvisning, «Vælg billede» /
«Skift billede» / «Fjern billede», træk og slip). Der er ingen foto-URL længere: eksterne billeder lækkede besøgendes
IP-adresser til tredjepart, og CSP'ens `img-src` er nu kun `'self' data: blob:`.
- Kun JPEG, PNG og WebP på højst 5 MB, genkendt ud fra filens første bytes (samme magic bytes-hjælper som optagelser,
  `detectImageType` i `media-type.ts`). SVG (XSS), GIF, HEIC m.fl. afvises. Mindst 200 × 200 px.
- Behandling med `sharp` (libvips, fast version): roteres efter EXIF, **alle metadata fjernes** (EXIF/GPS/XMP/ICC),
  centreret beskæring til kvadrat, 512 × 512 WebP (kvalitet 82) + 96 × 96-miniature. Højst 50 megapixel ind
  (`limitInputPixels`, mod dekompressionsbomber), tidsgrænse pr. billede og samme grænse for samtidigt tungt arbejde som upload af optagelser.
- Lagres via storage-adapteren (lokalt / Hetzner Object Storage, **privat** bucket) som `avatars/<id>/<tilfældig>.webp`
  og `…-96.webp`. Et nyt billede sletter de gamle objekter; upload, skift og fjernelse audit-logges (`advisor.photo.*`).
- Serveres af appen: `GET /api/avatar/<id>?size=512|96&v=<version>` streamer fra lageret med `Content-Type: image/webp`,
  `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin` og `Cache-Control: public, max-age=31536000, immutable`
  (versionen er tidspunktet for seneste upload, så en ny upload giver en ny URL). Manglende billede, ukendt rådgiver
  og manglende adgang giver det samme 404.
- **Adgang (beslutning):** onboarding-kataloget (`/kom-i-gang`) vises før login, så **aktive** rådgiveres fotos er
  offentlige – de er jo netop til at blive vist for kommende kunder. **Inaktive** rådgiveres fotos ser kun admin og
  rådgiveren selv (`private`-cache); alle andre får 404, og siderne viser initialer i stedet.
- Én komponent, `<AdvisorAvatar>` (`src/components/advisor-avatar.tsx`), bruges overalt: board-builder og katalog,
  kundens dashboard, mødesiden, admin-listerne, abonnementer og mødeadministration. Små visninger bruger miniaturen.

**Møder holdes altid med hele boardet** (ejerens beslutning). Booking kræver alle boardets pladser; admin kan udskifte en rådgiver i et
møde eller tilføje en ekstra deltager, men ikke fjerne en rådgiver, så mødet får færre end boardet («udskift i stedet»). Slettes en
rådgiver (GDPR), audit-logges de berørte møder, og admin-forsiden viser «Møder uden hele boardet».

**Ansvarlig rådgiver (`src/lib/lead.ts`).** Hvert board har præcis én ansvarlig rådgiver blandt rådgivere med det interne admin-tag
«Lead-kvalificeret» (systemtag, `Tag.kind = ADMIN`, `systemKey = "lead"`). Et board skal have mindst én kvalificeret rådgiver (matching,
board-builder og server-validering). Ved køb tildeles den kvalificerede med færrest ansvarsroller (lige: færrest pladser, laveste pris,
navn) under en advisory lock. Forlader den ansvarlige boardet, deaktiveres, slettes eller mister tagget, tildeles en ny automatisk; ellers
vises boardet for admin. Admin kan vælge manuelt (`/admin/subscriptions/[id]`) og se fordelingen samt et udligningsforslag på
`/admin/ansvarlige`, som kun anvendes efter bekræftelse. Interne admin-tags vises aldrig for kunder eller rådgivere og bruges ikke i
matchingen. Skift af ansvarlig sender notifikationen «Ansvarlig rådgiver ændret» (`board_lead_changed`).

**Booking.** Et tidspunkt tilbydes kun, hvis *alle* rådgivere i boardet er ledige (inden for en ugentlig regel, ingen blokering,
intet andet møde inkl. 30 min buffer). Vindue: 2 dage – 16 uger frem. Kvote: ét møde pr. periode (frekvens i uger regnet fra
abonnementets start), kun aktuel og næste periode kan bookes. Aflysning ≥ 48 t før start frigiver kvoten. Ved booking
tages advisory locks på abonnement og rådgivere, og alt valideres igen i transaktionen. Danske helligdage (også påskeafhængige;
Store bededag kun til og med 2023) samt juleaftens- og nytårsaftensdag spærres; admin kan slå enkelte datoer til og fra under
*Admin → Helligdage*. Fravær kan slutte kl. 24:00.

**Møder og transskription.** Mødesiden viser videorummet kun til deltagere (kunden, boardets rådgivere, admin) efter at
optagelsesnotits er accepteret. Manuel upload går aldrig gennem en server action: med S3 uploader browseren direkte til bucketten
(presigned POST, højst 500 MB håndhævet af lageret), lokalt streames filen til disk. Formatet tjekkes ud fra filens første bytes
(magic bytes), og antallet af samtidige uploads er begrænset. Optagelser (webhook fra videoudbyder eller manuel upload) går i jobkøen →
`transcribe()` → `summarize()` → vises på mødesiden. Optagelsen slettes efter transskription
(`DELETE_RECORDINGS_AFTER_TRANSCRIPTION`). Jobs behandles i processen og kan samles op via `GET/POST /api/cron/process-jobs`
med `Authorization: Bearer $CRON_SECRET` (kald fra fx cron hvert minut).

**GDPR.** Dataeksport (JSON med udvalgte felter – fx aldrig værtens mødelink eller udbyder-id'er; profilbilledet som metadata med lagernøgler og tidspunkt plus en note om, hvordan selve billedet hentes eller rekvireres) og sletningsanmodning under *Konto*; sletning
opsiger abonnementet hos betalingsudbyderen, sletter optagelser og en rådgivers profilbillede (begge størrelser) i lageret og webhook-data med kundens oplysninger og fjerner notifikationslog,
leads og samtykker; webhook-payloads ryddes efter 30 dage; audit-log over admin-handlinger og adgang til transskriptioner (fejl i audit-loggen
giver en driftsalarm); samtykke ved tilmelding (vilkår, optagelse, evt. markedsføring med ordret tekst og version); afmelding via link/STOP/Konto; notifikationsloggen (standard 12 mdr.) og leads med samtykke (24 mdr.) ryddes af jobkøen; ingen tredjeparts-analytics eller eksterne fonte.

## Leverandører og hvorfor

| Behov | Leverandør | Land | Bemærkning |
|---|---|---|---|
| Hosting (app + Postgres) | Hetzner Cloud eller Simply.com VPS | DE / DK | Docker-image + docker-compose |
| Abonnementsbetaling | Frisbii (tidl. Reepay) | DK | Hosted checkout + webhooks, MobilePay/kort |
| Videomøder | Whereby Embedded | NO (EØS) | REST-API til rum, cloud-optagelse til egen S3 |
| Optagelser og rådgiverfotos | Hetzner Object Storage (S3) | DE / FI | Privat bucket; `@aws-sdk/client-s3` kun som klientbibliotek. Opsætning: `docs/HETZNER-S3.md` |
| Transskription + resumé | Mistral AI (Voxtral + chat) | FR | Adapteren gør selvhostet Whisper muligt |
| SMS og e-mail (påmindelser, beskeder) | inMobile | DK | API v4 via `fetch`; SMTP (Simply.com/Brevo) kan bruges til e-mail i stedet |

Valget er drevet af, at ingen amerikanske selskaber er databehandlere. Se `docs/PLAN.md` for den fulde plan.

## Aktivér rigtige leverandører

1. **Frisbii:** opret 3 planer, én pr. frekvens: `abu-4w`, `abu-8w`, `abu-12w` (månedlig, moms efter jeres opsætning). Beløbet sættes pr. abonnement
   ved oprettelse (beløbs-override i øre, ekskl. moms) ud fra de valgte rådgivere; planskift sender det nye beløb. Feltnavnene til override skal
   verificeres mod Frisbii (se `docs/OPEN_ITEMS.md`). Sæt
   `PAYMENT_PROVIDER=frisbii`, `FRISBII_PRIVATE_KEY`, `FRISBII_WEBHOOK_SECRET`, og peg webhook til `{APP_URL}/api/webhooks/payments`.
   Webhooken verificeres med HMAC-SHA256 over den rå body og et tidsstempel (højst 5 min). Headerformatet er en antagelse samlet i
   `src/lib/payments/frisbii-signature.ts` og skal rettes til udbyderens dokumentation (Frisbii eller Alunta er ikke valgt endnu).
2. **Whereby:** `VIDEO_PROVIDER=whereby`, `WHEREBY_API_KEY`, `WHEREBY_WEBHOOK_SECRET`, optagelses-bucket (`WHEREBY_RECORDING_*`);
   webhook til `{APP_URL}/api/webhooks/video`.
3. **Storage:** `STORAGE_PROVIDER=s3` med `S3_*` (Hetzner Object Storage-endpoint, fx `https://fsn1.your-objectstorage.com`).
   Trin for trin (bucket, nøgler, CORS, livscyklus, versionering, DPA): **`docs/HETZNER-S3.md`**. Bucketten skal være privat og
   have en CORS-regel, der tillader `POST` fra `APP_URL` (direkte upload fra browseren). Endpointet tilføjes automatisk
   til CSP'ens `connect-src`. Kontrollér med `npm run storage:check`.
4. **Mistral:** `TRANSCRIPTION_PROVIDER=mistral`, `MISTRAL_API_KEY`.
5. **inMobile (SMS og e-mail):** `SMS_PROVIDER=inmobile`, `EMAIL_PROVIDER=inmobile`, `INMOBILE_API_KEY`, `INMOBILE_WEBHOOK_SECRET`, `SMS_SENDER`, `EMAIL_FROM`; peg inMobile-webhook til `{APP_URL}/api/webhooks/inmobile` med hemmeligheden i headeren `x-webhook-secret` (eller `?secret=…`, hvis inMobile ikke kan sende headers). Rotation: sæt den gamle i `INMOBILE_WEBHOOK_SECRET_PREVIOUS`. SMS sendes kun til lande på tilladt-listen (standard Danmark) og med lofter pr. nummer og døgn (*Admin → Notifikationer → Indstillinger*). Sæt også `APP_SECRET` (signerede afmeldingslinks). API-felterne er skrevet efter bedste viden og skal verificeres (se `docs/OPEN_ITEMS.md`). Alternativ til e-mail: `EMAIL_PROVIDER=smtp` + `SMTP_*`.
6. **CVR:** `CVR_PROVIDER=cvrapi` + `CVR_USER_AGENT` (standard i produktion), eller `virk` + `CVR_VIRK_USERNAME`/`CVR_VIRK_PASSWORD`.

## Deployment til Hetzner / Simply.com

Produktionen er **fail-closed**: med `NODE_ENV=production` (Docker-imaget og `next start`) nægter appen at starte, hvis konfigurationen ikke
er klar (mock/console/local-udbydere, manglende hemmeligheder, http-adresse, ukendte værdier). Loggen viser `[config] Appen starter ikke`
og en liste over, hvad der mangler – uden at skrive hemmeligheder ud. Ved en gyldig opstart logges de valgte udbydere.

1. Opret en Linux-VPS (Hetzner Cloud CX22 eller Simply.com VPS) i EU, installér Docker + Compose plugin.
2. Peg et domæne (A-record) på serveren; kør en reverse proxy med automatisk TLS foran appen, fx Caddy:
   `abu.example.dk { reverse_proxy localhost:3000 }`. Caddy sætter `X-Forwarded-For`, så sæt **`TRUSTED_PROXY_HOPS=1`**
   (antallet af proxies foran appen; med en CDN foran Caddy: 2). Appen må ikke kunne nås uden om proxyen (luk port 3000 i firewallen),
   ellers kan klienten forfalske sin IP. Begræns gerne body-størrelsen i proxyen (fx 20 MB – store optagelser går direkte til S3).
3. Klon repoet, `cp .env.example .env`, og sæt alle **påkrævede variabler**:

   | Variabel | Krav i produktion |
   |---|---|
   | `APP_URL` | `https://…` (ikke localhost) |
   | `DATABASE_URL` / `POSTGRES_PASSWORD` | sat eksplicit; stærk adgangskode |
   | `APP_SECRET`, `CRON_SECRET` | mindst 32 tilfældige tegn hver (`openssl rand -base64 48`) |
   | `TRUSTED_PROXY_HOPS` | ≥ 1 |
   | `PAYMENT_PROVIDER=frisbii` + `FRISBII_PRIVATE_KEY`, `FRISBII_WEBHOOK_SECRET` | betaling |
   | `VIDEO_PROVIDER=whereby` + `WHEREBY_API_KEY`, `WHEREBY_WEBHOOK_SECRET` | video |
   | `TRANSCRIPTION_PROVIDER=mistral` + `MISTRAL_API_KEY` | transskription |
   | `EMAIL_PROVIDER=inmobile` eller `smtp` (+ `SMTP_HOST`), `SMS_PROVIDER=inmobile`, `INMOBILE_API_KEY`, `INMOBILE_WEBHOOK_SECRET`, `EMAIL_FROM` | beskeder |
   | `STORAGE_PROVIDER=s3` + `S3_ENDPOINT` (https), `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | lager (`docs/HETZNER-S3.md`) |
   | `CVR_PROVIDER=cvrapi` + `CVR_USER_AGENT` med jeres kontaktadresse (eller `virk` + login) | CVR |
   | `APP_ENV` | tom (eller `production`) – sæt **aldrig** `development` i drift |

4. `docker compose up -d --build` – `migrate`-servicen kører `prisma migrate deploy` (med `NODE_ENV=production`), derefter starter appen.
5. Opret den første administrator (kør **aldrig** seed i produktion – det afvises):
   `docker compose run --rm migrate npm run create-admin -- --email admin@firma.dk --name "Fornavn Efternavn"`.
   Scriptet udskriver et engangslink (7 dage) i terminalen; åbn det og vælg adgangskode. Der står ingen adgangskode i koden eller loggen.
   Nyt link til en eksisterende admin: `npm run create-admin -- --email admin@firma.dk --reset`.
6. Cron (kun hvis `IN_PROCESS_SCHEDULER=false`; ellers kører jobkøen og notifikationerne hvert minut i appen): `* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://abu.example.dk/api/cron/process-jobs`.
7. Backup: `pg_dump` af Postgres-volumen dagligt (fx til Hetzner Storage Box) med testet gendannelse.
8. Overvågning: alle driftsalarmer står i loggen med præfikset `[ALERT]` (SMS-lofter, blokerede SMS-lande, fejl i audit-loggen) og under
   *Driftsalarmer* på admin-forsiden. Sæt log-overvågningen til at alarmere på `[ALERT]` og `[config] Appen starter ikke`.

**Sikkerhedsheaders** sættes af `src/proxy.ts`: CSP med nonce pr. request (scripts kun med nonce, `frame-src` kun Whereby, `img-src 'self' data: blob:` – ingen eksterne billedværter), HSTS (2 år,
`includeSubDomains`; overvej `preload`, når domænet er endeligt), Permissions-Policy (kamera/mikrofon/skærmdeling kun på mødesiderne),
`X-Frame-Options`, `Referrer-Policy` og `nosniff`. Alle sider renderes dynamisk, fordi noncen skal være ny pr. request.

Hvis Postgres og app kører på to servere, sæt `DATABASE_URL` direkte i `.env` og fjern `postgres`-servicen fra compose-filen.

**CI** (`.github/workflows/ci.yml`): `npm ci`, `npm audit --omit=dev --audit-level=high`, lint, typetjek, tests mod en Postgres-service,
build, et tjek af at produktionsbuildet nægter at starte med mock-konfiguration, og `docker build`. Afhængigheder opdateres ugentligt og
grupperet af Renovate (`renovate.json`) med review.

## Test

```bash
npm test                                                     # enhedstests; DB-tests springes over
TEST_DATABASE_URL=postgresql://abu:abu@localhost:5432/abu_test npm test   # også DB-tests (testdatabasen migreres først)
npm run lint && npm run typecheck && npm run build
npm audit --omit=dev --audit-level=high
```
