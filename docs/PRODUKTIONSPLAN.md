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

| # | Fund | Ændring | Accept-kriterie |
|---|---|---|---|
| 1 | **C-1** Mock-udbydere er standard. Gratis abonnement, hvis `PAYMENT_PROVIDER` mangler | Fail-closed opstartstjek: i `NODE_ENV=production` nægter appen at starte, hvis en udbyder er mock/console/local, hvis `APP_SECRET`/`CRON_SECRET`/webhook-hemmeligheder er tomme, eller hvis `APP_URL` ikke er https. Ukendte værdier giver fejl i stedet for et stille fald tilbage til standard. Aktivering på `subscribe/success` kun i mock, ellers kun via signeret webhook. | Unit-test af guard, og produktionsbuild med mock-konfiguration fejler ved start. |
| 2 | **H-1** Seed med kendte adgangskoder | Seed nægter at køre i production. Nyt `npm run create-admin` laver første admin med invitationslink (ingen adgangskode i kode). README rettes. | `create-admin` virker, og seed i prod afvises. |
| 3 | **H-3** Reset- og invitationslinks i logs | Konsol-adaptere redigerer links, e-mails og telefonnumre væk, og følsomme beskeder logges aldrig. Konsol-adaptere er forbudt i prod (punkt 1). | Test: log-output indeholder ikke token. |
| 4 | **H-4** Frisbii-webhookens signatur dækker ikke selve beskeden | HMAC over den rå request-body, krav om at tidsstemplet er højst 5 min gammelt, og stadig idempotens. Det præcise skema verificeres mod Frisbii/Alunta, når kontoen findes. | Test: manipuleret body afvises, og gammelt tidsstempel afvises. |
| 5 | **H-2** Login-spærring kan omgås ved at skifte X-Forwarded-For | Klient-IP tages kun fra en betroet proxy (`TRUSTED_PROXY_HOPS`). Fejlede forsøg tælles pr. konto i databasen med eskalerende spærring (5 forsøg → 15 min osv.). Rate limits gemmes i Postgres-tabellen `RateLimit` i stedet for i hukommelsen, så de overlever genstart og flere instanser. | Test: roterende XFF låser stadig kontoen. |
| 6 | **H-5** Upload af optagelser lægges i RAM med en grænse på 500 MB | Upload streames direkte til lager. I produktion bruges en presigned S3-upload direkte fra browseren, med server-tjek bagefter. Body-grænsen sænkes til 10 MB for almindelige actions, og der er en grænse for samtidige uploads. | Upload på 400 MB holder hukommelsen flad. |
| 7 | **H-6** Sårbare pakker (next/postcss, prisma) | Opgradér til patchede versioner, fastlås versioner og kør `npm audit --omit=dev --audit-level=high` i CI. | `npm audit --omit=dev` giver 0 høje. |

## Fase 2 – Mellem og lave fund + platform-hærdning
Estimat: 2–3 dage (inkl. QA-punkterne).

| # | Fund | Ændring |
|---|---|---|
| 8 | **M-6** Manglende sikkerhedsheaders | Streng CSP med nonce, hvor `frame-src` kun tillader videoudbyderen. HSTS. Permissions-Policy, der kun tillader kamera og mikrofon på mødesiden. `COOKIE_SECURE` er tvunget i prod. |
| 9 | **M-1** Onboardingen afslører, om en e-mail har en konto | Trin 1 fortsætter altid. Findes kontoen, sendes en neutral e-mail ("Du har allerede en konto – log ind her"), og siden viser ingen forskel. |
| 10 | **M-2** Kunder kan se værtens mødelink i dataeksporten | Eksporten vælger kun de felter, personen har ret til. `hostRoomUrl` og udbyder-ID'er udelades. |
| 11 | **M-3** Sletning efterlader persondata | Sletning fjerner optagelser fra lageret og webhook-payloads og opsiger abonnementet hos betalingsudbyderen. Webhook-payloads ryddes desuden efter 30 dage. |
| 12 | **M-8** Afmeldingslinks kan forfalskes, når `APP_SECRET` mangler | Kræver `APP_SECRET` (punkt 1). Fuld HMAC (256 bit), ingen afledte nøgler og en udløbsdato på 1 år. |
| 13 | **M-4** CVR-kvoten kan opbruges | Grænse pr. betroet IP og et globalt dagsbudget. Også "ikke fundet" caches, og ved misbrug kræves der et ekstra tjek (proof-of-work eller CAPTCHA fra en EU-leverandør, f.eks. Friendly Captcha fra Tyskland). |
| 14 | **M-5** Risiko for SMS-svindel mod dyre numre | SMS sendes kun til lande på en tilladt-liste (DK som standard, kan udvides i CMS). Loft pr. nummer og pr. døgn, og alarm ved høje SMS-udgifter. |
| 15 | **M-7** inMobile-webhooken | Bruger signatur, hvis inMobile understøtter det. Ellers en hemmelighed, der roteres. Kun kendte `messageId`'er opdateres, og STOP valideres mod kendte numre. |
| 16 | **M-9** Versioner | Faste versioner, kun `npm ci` og Renovate/Dependabot med review. |
| 17 | **L-1…L-5** | Ingen sideeffekter på GET. Fælles lager til rate limits (punkt 5). Alarm, hvis audit-loggen fejler. MIME-tjek ud fra filens indhold (magic bytes) i stedet for `octet-stream`. Strammere parsing af Whereby-signaturen. |
| 18 | **QA #1** Dobbeltsubmit (forhindres nu kun i browseren) | Serveren skal også kunne tåle gentagelser. Booking og "opret rådgiver" bruger en idempotensnøgle pr. formular, så et gentaget kald returnerer samme resultat i stedet for en fejl, og invitationslinket går ikke tabt. |
| 19 | **QA #13** Nye rådgivere er aktive, før de har accepteret invitationen | Rådgivere oprettes som inaktive og aktiveres automatisk, når invitationen er accepteret, og de har mindst ét tag og ugentlig tilgængelighed. Admin kan stadig aktivere manuelt. *(Min anbefaling – kræver dit ja.)* |
| 20 | **QA** Rådgiverpris kan sættes til 0–5 kr. | Pris skal ligge mellem 500 og 25.000 kr. (konfigurerbart). Det beskytter også mod abonnementer med beløbet 0 hos betalingsudbyderen. |
| 21 | **QA** Dybe links mistes ved login | `next`-parameter efter login (`safeNextPath` findes allerede), så links i påmindelser fører direkte til mødet. |
| 22 | **QA** Indtastninger går tabt ved fejl | Formularerne beholder indtastede værdier ved fejl (`useActionState`), især rådgiverprofil og CMS. Fejlbeskeder sendes ikke længere i URL'en. |
| 23 | **QA** Flash-beskeder og upload | Beskeder forsvinder ved genindlæsning, og upload-formularen skjules, når der allerede findes en færdig transskription. |
| 24 | **QA** Helligdage og heldagsfravær | Danske helligdage spærres automatisk for booking, og admin kan slå enkelte dage til eller fra. Fravær kan slutte kl. 24:00. |
| 25 | **QA** Mindre UX og tilgængelighed | "Spring til indhold"-link, kompakt admin-navigation på mobil, tydelig frekvensvælger i mobil-board-builderen, CMS-mailpreview der ikke er afskåret, læsbar samtykkeversion i leads, "Dit eget advisory board" og ens fejltekster. `/api/admin/leads` svarer 401 uden login. |

## Fase 3 – Konti, integrationer og jura (kræver dig)
| Område | Hvad | Hvem |
|---|---|---|
| Betaling | Vælg Frisbii eller Alunta. Kontrakt, testkonto og webhook. Herefter verificerer og retter jeg adapteren og signaturen (H-4). | Dig → mig |
| Video | Whereby Embedded-konto med optagelse til S3 og databehandleraftale (DPA). Herefter verificerer jeg API og webhook. | Dig → mig |
| Transskribering | Mistral-konto med EU-hosting og DPA. Test med en rigtig dansk optagelse. | Dig → mig |
| E-mail og SMS | inMobile-konto: API-nøgle, afsendernavn, e-maildomæne med SPF/DKIM/DMARC og DPA. Herefter verificerer jeg API-felterne. | Dig → mig |
| CVR | cvrapi.dk. Overvej en betalt nøgle, hvis gratis-kvoten ikke rækker. | Dig |
| Hosting | Hetzner (DE) eller Simply.com (DK): server, managed Postgres eller Postgres på serveren, Object Storage og domæne med TLS. | Dig → mig |
| Kontrast (QA #14) | Hvid tekst på guldknapper har en kontrast på 2,81:1, og guld-mørke eyebrows 3,0–3,5:1. Begge er under WCAG AA for lille tekst. Designmanualen kalder selv guld på hvid "utilstrækkelig". Forslag: charcoal-tekst på guldknapper (5,4:1) og navy eyebrows på lyse flader. Tilgængelighedsloven/EAA gælder fra 2025 for digitale tjenester til forbrugere, og ABU er B2B, så den er nok ikke et krav, men det er god praksis. | Dig (brandbeslutning) |
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
