# Plan: Advisory Board Unlimited i produktion

Grundlag: sikkerhedsaudit 17.10.2026 (`docs/SECURITY-AUDIT.md`, 1 kritisk, 6 høje, 9 mellem, 5 lave), 360°-QA (`docs/QA-360.md`) og `docs/OPEN_ITEMS.md`.

**360°-QA:**
- QA fandt 14 fejl. 12 er allerede rettet (dobbeltsubmit i browseren, bekræftelse af destruktive handlinger, dansk 404- og fejlside, Enter i katalogsøgning, datomønster, dublet-tags, overlappende tidsrum og tekst/format).
- De 2 åbne fund (nye rådgivere aktive for tidligt, og kontrast) og QA's UX-anbefalinger er lagt ind nedenfor som punkt 18–25 og i fase 3 og 4.
- Der er ingen modstrid med auditten. Flere QA-observationer forsvinder med fase 1: mock-videotekst for kunder (C-1) og seed-adgangskode under 10 tegn (H-1).

Planen har fire faser. Fase 1 og 2 er kode, som kan laves nu uden eksterne konti. Fase 3 kræver konti og beslutninger fra dig. Fase 4 er drift efter lancering.

**Status på det, der allerede er solidt:**
- Rettighedstjek sker på serveren i hver handling, ikke kun i middleware.
- Ingen XSS-huller: der bruges ingen `dangerouslySetInnerHTML`, og alt indhold escapes.
- Booking er sikret mod dobbeltbooking med låse i databasen.
- Priser beregnes altid på serveren, så klienten ikke kan manipulere dem.
- Stærke sessions- og reset-tokens (256 bit, kun gemt som hash) og bcrypt.
- Cron-ruten afviser kald uden korrekt hemmelighed, og der sendes ingen source maps til browseren.

---

## Fase 1 – Kritiske og høje fund (blokerer lancering)
Implementeres med Opus 5.5 (Høj). Estimat: 1–2 dages udviklingsarbejde.

| # | Fund | Ændring | Accept-kriterie | Status (18.10.2026) |
|---|---|---|---|---|
| 1 | **C-1** Mock-udbydere er standard. Gratis abonnement, hvis `PAYMENT_PROVIDER` mangler | Fail-closed opstartstjek: i `NODE_ENV=production` nægter appen at starte, hvis en udbyder er mock/console/local, hvis `APP_SECRET`/`CRON_SECRET`/webhook-hemmeligheder er tomme, eller hvis `APP_URL` ikke er https. Ukendte værdier giver fejl i stedet for et stille fald tilbage til standard. Aktivering på `subscribe/success` kun i mock, ellers kun via signeret webhook. | Unit-test af guard, og produktionsbuild med mock-konfiguration fejler ved start. | ✅ Udført – `16314de`. Guard i `instrumentation.ts`/`env.ts`; prod-build med mock nægter at starte (verificeret lokalt, i Docker og som CI-trin). Testbetaling kun i mock via POST. |
| 2 | **H-1** Seed med kendte adgangskoder | Seed nægter at køre i production. Nyt `npm run create-admin` laver første admin med invitationslink (ingen adgangskode i kode). README rettes. | `create-admin` virker, og seed i prod afvises. | ✅ Udført – `3fc0474`. `npm run create-admin` (engangslink); seed afvises i produktion (også i compose `migrate`). |
| 3 | **H-3** Reset- og invitationslinks i logs | Konsol-adaptere redigerer links, e-mails og telefonnumre væk, og følsomme beskeder logges aldrig. Konsol-adaptere er forbudt i prod (punkt 1). | Test: log-output indeholder ikke token. | ✅ Udført – `abfd648`. Links/adresser/numre redigeres; følsomme beskeder logges slet ikke. |
| 4 | **H-4** Frisbii-webhookens signatur dækker ikke selve beskeden | HMAC over den rå request-body, krav om at tidsstemplet er højst 5 min gammelt, og stadig idempotens. Det præcise skema verificeres mod Frisbii/Alunta, når kontoen findes. | Test: manipuleret body afvises, og gammelt tidsstempel afvises. | ✅ Udført – `64f4a68` (+ L-5). Skemaet er samlet i én konstant, så det kan rettes til Frisbii eller Alunta. |
| 5 | **H-2** Login-spærring kan omgås ved at skifte X-Forwarded-For | Klient-IP tages kun fra en betroet proxy (`TRUSTED_PROXY_HOPS`). Fejlede forsøg tælles pr. konto i databasen med eskalerende spærring (5 forsøg → 15 min osv.). Rate limits gemmes i Postgres-tabellen `RateLimit` i stedet for i hukommelsen, så de overlever genstart og flere instanser. | Test: roterende XFF låser stadig kontoen. | ✅ Udført – `e9ac0af`. Verificeret: 5 forkerte forsøg med skiftende XFF spærrer kontoen (også for rigtig adgangskode). |
| 6 | **H-5** Upload af optagelser lægges i RAM med en grænse på 500 MB | Upload streames direkte til lager. I produktion bruges en presigned S3-upload direkte fra browseren, med server-tjek bagefter. Body-grænsen sænkes til 10 MB for almindelige actions, og der er en grænse for samtidige uploads. | Upload på 400 MB holder hukommelsen flad. | ✅ Udført – `c8b6e31`, `23afefd`. Lokal stream: 400 MB upload øgede serverens RSS med ca. 24 MB (296 → 320 MB). S3: presigned POST direkte fra browseren. `bodySizeLimit` 10 MB. |
| 7 | **H-6** Sårbare pakker (next/postcss, prisma) | Opgradér til patchede versioner, fastlås versioner og kør `npm audit --omit=dev --audit-level=high` i CI. | `npm audit --omit=dev` giver 0 høje. | ✅ Udført – `c1e8e52`. Next 16.4.2 og Prisma 7.10.1 (eneste patchede linjer); `npm audit --omit=dev --audit-level=high`: 0 sårbarheder. |

## Fase 2 – Mellem og lave fund + platform-hærdning
Estimat: 2–3 dage (inkl. QA-punkterne).

| # | Fund | Ændring | Status (18.10.2026) |
|---|---|---|---|
| 8 | **M-6** Manglende sikkerhedsheaders | Streng CSP med nonce, hvor `frame-src` kun tillader videoudbyderen. HSTS. Permissions-Policy, der kun tillader kamera og mikrofon på mødesiden. `COOKIE_SECURE` er tvunget i prod. | ✅ Udført – `27330b2`. Ingen CSP-fejl i Chromium på offentlige, kunde- og admin-sider, dnd-kit og srcDoc-forhåndsvisning. |
| 9 | **M-1** Onboardingen afslører, om en e-mail har en konto | Trin 1 fortsætter altid. Findes kontoen, sendes en neutral e-mail ("Du har allerede en konto – log ind her"), og siden viser ingen forskel. | ✅ Udført – `4640815`. Trin 1 er identisk for ny/eksisterende e-mail (verificeret). Rest: trin 6 kan stadig skelne (kræver e-mailbekræftelse før kontooprettelse – se OPEN_ITEMS). |
| 10 | **M-2** Kunder kan se værtens mødelink i dataeksporten | Eksporten vælger kun de felter, personen har ret til. `hostRoomUrl` og udbyder-ID'er udelades. | ✅ Udført – `724adc2`. |
| 11 | **M-3** Sletning efterlader persondata | Sletning fjerner optagelser fra lageret og webhook-payloads og opsiger abonnementet hos betalingsudbyderen. Webhook-payloads ryddes desuden efter 30 dage. | ✅ Udført – `c938957`. |
| 12 | **M-8** Afmeldingslinks kan forfalskes, når `APP_SECRET` mangler | Kræver `APP_SECRET` (punkt 1). Fuld HMAC (256 bit), ingen afledte nøgler og en udløbsdato på 1 år. | ✅ Udført – `29d30c4`. Gamle links er ikke bevaret (før lancering). |
| 13 | **M-4** CVR-kvoten kan opbruges | Grænse pr. betroet IP og et globalt dagsbudget. Også "ikke fundet" caches, og ved misbrug kræves der et ekstra tjek (proof-of-work eller CAPTCHA fra en EU-leverandør, f.eks. Friendly Captcha fra Tyskland). | ✅ Udført – `91fea95` (uden CAPTCHA; TODO i OPEN_ITEMS: Friendly Captcha). |
| 14 | **M-5** Risiko for SMS-svindel mod dyre numre | SMS sendes kun til lande på en tilladt-liste (DK som standard, kan udvides i CMS). Loft pr. nummer og pr. døgn, og alarm ved høje SMS-udgifter. | ✅ Udført – `268ebd3`. Landeliste og lofter i Admin → Notifikationer → Indstillinger; alarmer på admin-forsiden. |
| 15 | **M-7** inMobile-webhooken | Bruger signatur, hvis inMobile understøtter det. Ellers en hemmelighed, der roteres. Kun kendte `messageId`'er opdateres, og STOP valideres mod kendte numre. | 🟡 Delvist – `b2a85c9`. Header-hemmelighed, rotation, kendte beskeder/numre. Signatur afventer inMobiles dokumentation. |
| 16 | **M-9** Versioner | Faste versioner, kun `npm ci` og Renovate/Dependabot med review. | ✅ Udført – `c1e8e52` (låste versioner), `ab7ed4a` (Renovate + CI). |
| 17 | **L-1…L-5** | Ingen sideeffekter på GET. Fælles lager til rate limits (punkt 5). Alarm, hvis audit-loggen fejler. MIME-tjek ud fra filens indhold (magic bytes) i stedet for `octet-stream`. Strammere parsing af Whereby-signaturen. | ✅ Udført – L-1 `16314de`, L-2 `e9ac0af`/`91fea95`, L-3 `740bc1b`, L-4 `c8b6e31`, L-5 `64f4a68`. |
| 18 | **QA #1** Dobbeltsubmit (forhindres nu kun i browseren) | Serveren skal også kunne tåle gentagelser. Booking og "opret rådgiver" bruger en idempotensnøgle pr. formular, så et gentaget kald returnerer samme resultat i stedet for en fejl, og invitationslinket går ikke tabt. | ✅ Udført – `8105fcd`. |
| 19 | **QA #13** Nye rådgivere er aktive, før de har accepteret invitationen | Rådgivere oprettes som inaktive og aktiveres automatisk, når invitationen er accepteret, og de har mindst ét tag og ugentlig tilgængelighed. Admin kan stadig aktivere manuelt. *(Min anbefaling – kræver dit ja.)* | ✅ Udført efter ejerens beslutning (manuel aktivering, ingen auto-aktivering) – `6f523c5`. |
| 20 | **QA** Rådgiverpris kan sættes til 0–5 kr. | Pris skal ligge mellem 500 og 25.000 kr. (konfigurerbart). Det beskytter også mod abonnementer med beløbet 0 hos betalingsudbyderen. | ✅ Udført – `218642e`. |
| 21 | **QA** Dybe links mistes ved login | `next`-parameter efter login (`safeNextPath` findes allerede), så links i påmindelser fører direkte til mødet. | ✅ Udført – `957203d`. |
| 22 | **QA** Indtastninger går tabt ved fejl | Formularerne beholder indtastede værdier ved fejl (`useActionState`), især rådgiverprofil og CMS. Fejlbeskeder sendes ikke længere i URL'en. | ✅ Udført – `3e96719`, `4e707e1` (rådgiverprofil, tilgængelighed, opret rådgiver, konto, login, nulstilling, onboarding trin 1-2; CMS-editorerne beholdt allerede værdierne). |
| 23 | **QA** Flash-beskeder og upload | Beskeder forsvinder ved genindlæsning, og upload-formularen skjules, når der allerede findes en færdig transskription. | ✅ Udført – `77dfa35`. |
| 24 | **QA** Helligdage og heldagsfravær | Danske helligdage spærres automatisk for booking, og admin kan slå enkelte dage til eller fra. Fravær kan slutte kl. 24:00. | ✅ Udført – `b844507` (24:00 i `3e96719`). Admin → Helligdage. |
| 25 | **QA** Mindre UX og tilgængelighed | "Spring til indhold"-link, kompakt admin-navigation på mobil, tydelig frekvensvælger i mobil-board-builderen, CMS-mailpreview der ikke er afskåret, læsbar samtykkeversion i leads, "Dit eget advisory board" og ens fejltekster. `/api/admin/leads` svarer 401 uden login. | ✅ Udført – `b6c45d5`. |

**Ud over planen (18.10.2026):** CI i GitHub Actions (`ab7ed4a`: npm ci, audit, lint, typetjek, tests mod Postgres, build, prod-guard-boot, `docker build`), `.dockerignore` holder `.env*` ude af imaget, og Docker-imaget er bygget og kørt lokalt (mock-konfiguration nægter at starte; dev-konfiguration svarer).

## Fase 3 – Konti, integrationer og jura (kræver dig)
| Område | Hvad | Hvem |
|---|---|---|
| Betaling | Vælg Frisbii eller Alunta. Kontrakt, testkonto og webhook. Herefter verificerer og retter jeg adapteren og signaturen (H-4: rå-body-HMAC + tidsstempel er bygget; kun skemaet i `src/lib/payments/frisbii-signature.ts` skal tilpasses). | Dig → mig |
| Video | Whereby Embedded-konto med optagelse til S3 og databehandleraftale (DPA). Herefter verificerer jeg API og webhook. | Dig → mig |
| Transskribering | Mistral-konto med EU-hosting og DPA. Test med en rigtig dansk optagelse. | Dig → mig |
| E-mail og SMS | inMobile-konto: API-nøgle, afsendernavn, e-maildomæne med SPF/DKIM/DMARC og DPA. Herefter verificerer jeg API-felterne. | Dig → mig |
| CVR | cvrapi.dk. Overvej en betalt nøgle, hvis gratis-kvoten ikke rækker. | Dig |
| Hosting | Hetzner (DE) eller Simply.com (DK): server, managed Postgres eller Postgres på serveren, Object Storage og domæne med TLS. | Dig → mig |
| Kontrast (QA #14) | ✅ Afprøvet og beholdt efter ejerens beslutning (`f0ec529`): charcoal-tekst på guldknapper (5,57:1), navy eyebrows på lyse flader (11,97:1), plus pladsholdere, stepper og guld som tekst rettet til AA – alt via design-tokens. Før/efter og målinger: `docs/screens/kontrast/`. Mellemvej, hvis guldet savnes: «guld-blæk» #81693c til eyebrows (én token). | Dig (endelig godkendelse) |
| Jura | Advokatgennemgang af vilkår, privatlivspolitik, samtykketekster (optagelse og marketing) og opbevaringsperioder. Fortegnelse (art. 30). DPIA for optagelse og transskribering. DPA'er med alle leverandører. | Dig + advokat |

## Fase 4 – Drift og lancering
- **Infrastruktur:** Docker Compose på Hetzner med Caddy (automatisk TLS og HSTS) foran appen, ingen offentlig databaseport, firewall og fail2ban, automatiske sikkerhedsopdateringer af OS og månedlig genbygning af image.
- **Hemmeligheder:** genereres med `openssl rand` og gemmes i Docker secrets eller en `.env`, som kun root kan læse, uden for repoet. Der er en dokumenteret rotationsprocedure.
- **Backup:**
  - Daglig `pg_dump`, krypteret og gemt uden for serveren i Hetzner Storage Box i et andet datacenter.
  - 30 dages opbevaring.
  - Gendannelsen testes hver måned.
  - Object Storage med versionering.
- **Overvågning og alarmer (EU-værktøjer):**
  - Oppetid: f.eks. Better Stack (EU-region) eller selvhostet Uptime Kuma.
  - Fejl: selvhostet GlitchTip.
  - Alarmer ved fejlede webhooks, høje SMS-udgifter, fejlede jobs i køen, gentagne fejlede logins og fejl i audit-loggen.
- **CI (GitHub Actions):** lint, typetjek, test, build, `npm audit` og secret-scanning ved hver PR, plus et tjek af, at prod-konfigurationen ikke bruger mock. Branch-beskyttelse på `main`.
- **Pre-launch-tjekliste:**
  - Staging-miljø med rigtige testkonti.
  - End-to-end-test af betaling, møde, optagelse, transskription og notifikationer.
  - Belastningstest af booking og upload.
  - Det, QA ikke kunne teste:
    - Safari og Firefox (også iOS).
    - Skærmlæser (VoiceOver/NVDA).
    - Mails og SMS'er vist i rigtige klienter (Outlook, Gmail, Apple Mail).
    - Docker-build i CI.
    - Rigtigt sessionsudløb.
  - En gennemgang med `npm run create-admin`.
  - Restore-test.
  - Ekstern pentest (anbefalet, f.eks. et dansk firma) før de første betalende kunder.
- **Efter lancering:** månedlig afhængighedsopdatering, kvartalsvis gennemgang af adgang og logs og årlig pentest.

## Rækkefølge
1. Fase 1 og 2 (kode) kan startes med det samme.
2. Imens: du opretter konti (fase 3) og sætter juragennemgangen i gang.
3. Integrationerne verificeres, efterhånden som konti kommer.
4. Staging → pentest → lancering.
