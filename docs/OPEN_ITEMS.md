# Åbne punkter – Advisory Board Unlimited

Appen kører fuldt lokalt i mock-tilstand (betaling, video, transskribering, e-mail og lager er simuleret). Nedenfor er hvad der mangler for at gå i produktion.

## 1. Konti der skal oprettes

| # | Leverandør | Land | Formål | Hvad skal sættes op | Env-variabler |
|---|---|---|---|---|---|
| 1 | **Frisbii** (tidl. Reepay) – frisbii.com | DK | Månedligt abonnement, kort + MobilePay | Erhvervskonto + indløsningsaftale. Opret 3 planer, én pr. frekvens, med handles `abu-4w`, `abu-8w` og `abu-12w` (månedlig fakturering; momsopsætning ekskl. moms + 25 %). Beløbet pr. kunde sættes ved oprettelse af abonnementet (beløbs-override), så planernes eget beløb er kun en pladsholder. Opret webhook til `https://<domæne>/api/webhooks/payments`. | `PAYMENT_PROVIDER=frisbii`, `FRISBII_PRIVATE_KEY`, `FRISBII_WEBHOOK_SECRET` |
| 2 | **Whereby Embedded** – whereby.com | NO (EØS) | Videomøder med cloud-optagelse | Embedded-abonnement (et abonnement der inkluderer optagelse). Konfigurér optagelse til egen S3-bucket og webhook til `https://<domæne>/api/webhooks/video`. Indgå databehandleraftale. | `VIDEO_PROVIDER=whereby`, `WHEREBY_API_KEY`, `WHEREBY_WEBHOOK_SECRET` |
| 3 | **Mistral AI** – console.mistral.ai | FR | Transskribering (Voxtral) + mødereferat | API-konto. Vælg EU-hosting og slå træning på data fra. Indgå databehandleraftale. | `TRANSCRIPTION_PROVIDER=mistral`, `MISTRAL_API_KEY` |
| 4 | **Hetzner Cloud** – hetzner.com (alternativt Simply.com VPS) | DE / DK | Server til app + PostgreSQL | En server, f.eks. CX32 i Falkenstein/Nürnberg, med Docker. Daglig backup af Postgres. | `DATABASE_URL`, `APP_URL` |
| 5 | **Hetzner Object Storage** | DE | Midlertidig lagring af optagelser | Bucket + adgangsnøgler | `STORAGE_PROVIDER=s3`, `S3_*` |
| 6 | **E-mail og SMS – inMobile** – inmobile.dk | DK | SMS og e-mail: bekræftelser, påmindelser, ufærdig tilmelding, invitation, nulstilling | **Ny konto at oprette (ejerens valg).** Opret API-nøgle, godkend afsendernavn (≤ 11 tegn, fx `ABUnlimited`) og afsenderdomæne til e-mail (SPF/DKIM/DMARC). Indgå databehandleraftale. Peg status-webhook til `{APP_URL}/api/webhooks/inmobile?secret=<INMOBILE_WEBHOOK_SECRET>`. Afklar, om en alfanumerisk afsender kan modtage «STOP»-svar (ellers: afmeldingslink / svarnummer). | `EMAIL_PROVIDER=inmobile`, `SMS_PROVIDER=inmobile`, `INMOBILE_API_KEY`, `INMOBILE_WEBHOOK_SECRET`, `SMS_SENDER` |
| 6b | E-mail via SMTP (alternativ til inMobile e-mail) – Simply.com mail eller Brevo | DK / FR | Samme beskeder som ovenfor | Afsenderadresse, f.eks. `noreply@<domæne>`, med SPF/DKIM/DMARC | `EMAIL_PROVIDER=smtp`, `SMTP_*` |
| 7 | **CVR-opslag** – **cvrapi.dk er standard i produktion (ejerens valg: gratis og nemt)**; Erhvervsstyrelsens virk.dk-adapter er bevaret som alternativ | DK | Slå virksomhedsdata op i onboarding (navn, adresse, branche, ansatte, status) | Ingen ansøgning til cvrapi.dk. Sæt `CVR_PROVIDER=cvrapi` i produktion og en beskrivende `CVR_USER_AGENT` med kontaktadresse. Vær opmærksom på den gratis dagskvote: ved overskridelse vises en pæn besked, og kunden kan fortsætte manuelt. | `CVR_PROVIDER=cvrapi` + `CVR_USER_AGENT` (alternativt `virk` + `CVR_VIRK_*`) |
| 8 | **Domæne** – f.eks. via Simply.com | DK | | DNS-records peger på serveren. TLS via Caddy/Traefik med Let's Encrypt. | |

Alunta (dansk abonnementsstyring) skal undersøges som mulig afløser/supplement til betaling (se nedenfor). Simply.com er allerede koblet til denne session. Jeg kan oprette DNS-records og mailkonto, når domænet er valgt.

## 2. Ejerens beslutninger (17.10.2026)

1. Seedet testindhold og rådgiverpriser er fine som udgangspunkt.
2. **Manuelt indtastede virksomheder: løsning a.** Ingen godkendelse kræves. Admin ser dem markeret «ikke verificeret» og kan filtrere på det (Admin → Kunder). Punktet er ikke længere åbent.
3. Admin kan ændre både den faste board-opstilling (`/admin/subscriptions/[id]`) og deltagere i det enkelte møde (`/admin/meetings/[id]`, pludseligt frafald).
4. **Betaling afklares senere.** **Alunta** (dansk abonnementsstyring) skal undersøges: kan den afløse eller supplere Frisbii (abonnement med variabelt beløb pr. kunde, MobilePay/kort, webhooks, API, databehandleraftale, pris)? Betalingsadapteren bevares uændret, og der bygges ikke noget nyt nu.
5. CVR: cvrapi.dk som standard i produktion; virk-adapteren bevares.
6. E-mail og SMS via inMobile. Tekster, frekvenser og udløsere styres i CMS'en (Admin → Notifikationer).
7. Onboarding trin 1 er en standard lead-boks med generelt markedsføringssamtykke (ikke forudkrydset), gemt som samtykkepost med tekst og version. Leads vises i Admin → Leads.
8. Alle tekster i onboarding redigeres i CMS'en (Admin → Onboarding → Tekster).
9. **Aktivering af rådgivere (18.10.2026):** rådgivere aktiveres manuelt af admin, når de er klar – ingen automatisk aktivering. Nye rådgivere oprettes inaktive og kan ikke vælges nogen steder (katalog, forslag, board-builder, booking, erstatning). Ved «Aktivér» vises en tjekliste (invitation accepteret, tags, ugentlig tilgængelighed, bio, pris); manglende punkter giver en advarsel, ikke en blokering. Deaktivering af en rådgiver i aktive boards advarer og viser de berørte kunder.
10. **Kontrast (18.10.2026):** forslaget er afprøvet og beholdt (charcoal på guldknapper, navy eyebrows). Endelig godkendelse af udtrykket mangler – se `docs/screens/kontrast/`.
11. **Betalingsudbyder er stadig uafklaret (Frisbii eller Alunta).** Webhook-signaturen er bygget generisk (rå body + tidsstempel); der er ikke bygget en Alunta-adapter.

## 2b. Beslutninger du stadig skal tage

1. **Prisformel – besluttet.** Ejeren har bekræftet, at formlen er korrekt og at alle priser er ekskl. moms. Formlen er nu *sum af rådgivernes mødepriser × (52 / uger) / 12* (hver rådgiver har sin egen pris, standard 1.750 kr.). Ved 1.750 kr. for alle giver den tabellen:

   | Frekvens | 2 rådgivere | 3 rådgivere | 4 rådgivere |
   |---|---|---|---|
   | Hver 4. uge | 3.792 | 5.688 | 7.583 |
   | Hver 8. uge | 1.896 | 2.844 | 3.792 |
   | Hver 12. uge | 1.264 | 1.896 | 2.528 |

   Prisen fastfryses ved køb. Hvis admin ændrer en rådgivers pris, påvirker det kun nye abonnementer og planskift.
2. **Mødelængde.** Standard er 2 timer (`MEETING_DURATION_MINUTES`).
3. **Hvem vælger rådgiverne?** Kunden får et forslag ud fra en test og kan frit udskifte, tilføje og fjerne rådgivere. Admin kan stadig sætte boardet manuelt (månedsprisen ændres ikke). (Besluttet: admin kan ændre både fast board og enkeltmøder.)
4. **Bindingsperiode og opsigelse.** Lige nu kan kunden opsige når som helst. Skal der være binding eller opsigelsesvarsel?
5. **Afbud.** Afbud senere end 48 timer før mødet tæller som brugt møde. Er det rigtigt?
6. **Opbevaring.** Optagelser slettes efter transskribering. Hvor længe skal transskriptioner gemmes?
7. **Honorering af rådgivere.** Der er ingen afregning eller rapport over afholdte møder pr. rådgiver endnu.

## 3. Juridisk / GDPR

- Udfyld privatlivspolitik og handelsbetingelser (`/privatliv`, `/vilkaar`). De er skabeloner med `[pladsholdere]` og bør gennemgås af en advokat.
- Databehandleraftaler med Frisbii, Whereby, Mistral, Hetzner og mailudbyder.
- Fortegnelse over behandlingsaktiviteter (art. 30) og en vurdering af, om optagelse og transskribering af møder kræver en konsekvensanalyse (DPIA).
- Samtykke til optagelse: gives nu eksplicit ved oprettelse af konto (kunder, trin 6) og ved accept af invitation (rådgivere); eksisterende brugere accepterer én gang ved næste login (`/samtykke`). Mødesiden viser kun en informationslinje. Få en jurist til at bekræfte ordlyden (redigerbar i CMS'en, versioneret) og om deltagere, der ikke selv er kunde/rådgiver, kan optræde.
- Markedsføringssamtykke (onboarding trin 1), leads, kontakt via e-mail/SMS og afmelding: gennemgå ordlyd, opbevaringsperioder (leads med samtykke 24 mdr., notifikationslog 12 mdr. – begge ændres i CMS'en), samt databehandleraftale med inMobile. Opdatér fortegnelsen over behandlingsaktiviteter (art. 30).

## 4. Kendte tekniske mangler

**Leverandør-integrationer skrevet efter dokumentation/hukommelse – ikke testet mod rigtige konti:**
- Frisbii: checkout-session, opsigelse, planskifte og webhook-format. **Nyt: beløbs-override pr. abonnement** (`subscription.amount` i øre og `amount_incl_vat=false` i checkout-sessionen og ved planskift) er et gæt og skal verificeres mod Frisbii API'et. Hvis override ikke understøttes, må der oprettes planer pr. prispunkt, eller prisen sættes via add-on/ordrelinje.
- CVR: feltnavnene i Erhvervsstyrelsens Elasticsearch-svar (`Vrvirksomhed.virksomhedMetadata.nyesteNavn/nyesteBeliggenhedsadresse/nyesteVirksomhedsform/nyesteHovedbranche/nyesteAarsbeskaeftigelse/stiftelsesDato/sammensatStatus`) og cvrapi.dk-svaret (`name, address, zipcode, city, companydesc, industrycode, industrydesc, startdate, enddate, employees`) er skrevet efter hukommelsen og skal verificeres, når adgangen er på plads. Virk-endpointet er `http://` (ikke TLS) ifølge dokumentationen; overvej at begrænse opslaget til serveren og at bede om en https-adresse.
- Whereby: mødeoprettelse med optagelse til S3, webhook-format/signatur, og om Whereby kan skrive til Hetzners S3-endpoint.
- Mistral: feltnavne i transskriberings-API'et og grænser for filstørrelse/varighed. Filen sendes nu som en disk-baseret Blob (ikke i RAM), men Mistrals maksimale filstørrelse skal afklares.

**Docker og test:**
- Docker-imaget er bygget og kørt lokalt 18.10.2026 (mock-konfiguration nægter at starte, dev-konfiguration svarer; `migrate`, `create-admin` og seed-afvisning testet i build-imaget). I sandkassen krævede `npm ci` i imaget proxyens CA (kun en lokal variant af Dockerfilen); CI kører et almindeligt `docker build .`. `docker compose` som helhed er ikke kørt.
- Lib-niveauet har nu DB-integrationstests (kører med `TEST_DATABASE_URL`, i CI mod en Postgres-service). Server actions og HTTP-ruter testes stadig kun end-to-end med Playwright (scripts uden for repoet): onboarding → testbetaling → booking → møde/upload/transskription, admin, CMS, notifikationer, leads.

**Onboarding og CMS (nyt):**
- Matching-vægtene i seed-testen er et kvalificeret bud og bør justeres af ejeren i CMS'et (`/admin/onboarding`) sammen med rådgivernes tags.
- En ophørt virksomhed blokerer tilmelding; ved mislykket opslag eller opbrugt kvote kan kunden indtaste navn og adresse manuelt (markeres «ikke verificeret» under Admin → Kunder; ingen godkendelse kræves).
- Genoptagelse af en ufærdig tilmelding fungerer kun i samme browser (cookie). Links i «tilmelding ikke færdig»-beskeder går til /kom-i-gang; et personligt genoptagelseslink kunne tilføjes.
- Rådgiverfoto er stadig en ekstern URL; kataloget viser initialer uden foto.
- CMS-ændringer er ikke versioneret ud over audit-loggen; der er ingen «fortryd».
- Rate limits og CVR-cache ligger i Postgres (`RateLimit`, `CvrLookupCache`) og deles mellem instanser.

**inMobile (nyt – skrevet efter bedste viden, ikke testet mod en rigtig konto). Gæt, der skal verificeres:**
- Base-URL `https://api.inmobile.com` og versionsstien `/v4/...`.
- Autentificering: HTTP Basic med API-nøglen som adgangskode (`Authorization: Basic base64(":" + nøgle)`). Måske er nøglen brugernavn, eller headeren hedder noget andet.
- SMS: `POST /v4/sms/outgoing` med `{ messages: [{ to, text, from, countryHint: "45", messageId, statusCallbackUrl }] }`. Er `to` E.164 med `+` eller uden? Hedder feltet `from` eller `sender`? Findes `messageId`/`statusCallbackUrl` på beskeden?
- E-mail: `POST /v4/email/outgoing` med `{ from: {email,name}, to: [{email,name}], subject, text, html, messageId, statusCallbackUrl }`. Er e-mail-API'et en del af v4 og aktiveret på kontoen, eller kræver det en separat aftale/endpoint? Afsenderdomæne-verifikation.
- Svar: `{ results: [{ messageId | id }] }` (vi falder tilbage til vores eget id).
- Statuswebhook: format `{ messageId, status | statusCode, ... }` (enkelt, liste eller `{events|results|messages}`), og om den kan signeres (vi bruger `?secret=` i URL'en i stedet). Mapping: delivered → LEVERET, failed/undelivered/expired/rejected → FEJLET.
- Indgående SMS (STOP): format `{ from, text }` og om en alfanumerisk afsender overhovedet kan modtage svar (typisk nej). Alternativer: dedikeret nummer/nøgleord hos inMobile, eller kun afmeldingslink i SMS'en (links til `/afmeld`).
- Grænser: tegnsæt/segmentering (vi tæller GSM-7 160/153 og UCS-2 70/67), rate limits, krav til afsendernavn, prissætning pr. SMS-del.

**Mangler i funktionalitet:**
- Ingen kalenderinvitationer (.ics) i mails. Påmindelser, bekræftelser, flytning/aflysning, «transskription klar» og betalingsrykkere (to trin) findes nu via notifikationssystemet.
- Honorar-afregning: `MeetingParticipant.pricePerMeetingDkk` registrerer rådgiverens pris pr. faktisk deltager, men der er endnu ingen rapport/afregning.
- Ved admin-ændring af pris sendes nyt beløb til betalingsudbyderen (`changePlan`); hvornår det træder i kraft (næste betalingsperiode) afhænger af Frisbii/Alunta og skal verificeres.
- Whereby: ved flytning af et møde oprettes et nyt rum (rum har faste datoer) og det gamle slettes; ved udskiftning af rådgiver genbruges rummet (hostRoomUrl deles). Verificér mod Whereby.
- Notifikationer sendes inline i den handling, der udløser dem (ingen kø med genforsøg ud over «Send igen» i loggen).
- Ingen e-mail-skabelon-tests mod rigtige klienter (Outlook/Gmail); SVG-logoet vises ikke i alle klienter (alt-tekst er reserve). Overvej et PNG-logo.
- Ingen admin-UI til at oprette flere admins eller redigere kunder. Admins oprettes med `npm run create-admin` (engangslink); seed afvises i produktion.
- Rådgiverfotos er eksterne URL'er; der er ingen upload.
- Møder der er afholdt uden optagelse markeres ikke automatisk som afholdt.

## 5. Leverandører der bevidst er fravalgt (amerikanske)
Stripe, Zoom/Teams/Daily, OpenAI/Deepgram/AssemblyAI, Vercel/AWS, Auth0/Clerk, SendGrid/Mailgun, Google Fonts/Analytics, Sentry. Next.js, Prisma og AWS S3-klienten bruges kun som open source-biblioteker, der kører på egen server. Der sendes ingen data til disse firmaer.

## 6. Opfølgning efter sikkerhedsrettelserne (fase 1 og 2, 18.10.2026)

- **TODO – CAPTCHA (M-4):** hvis CVR-opslag eller onboarding misbruges trods trusted-IP-grænser, dagsbudget og negativ cache, tilføj et ekstra tjek før eksterne opslag. EU-mulighed: **Friendly Captcha** (Tyskland, privatlivsvenlig proof-of-work, ingen cookies). Ikke bygget.
- **Betalingswebhook (H-4):** headerformat, nøgler og det signerede indhold er samlet i `PAYMENT_WEBHOOK_SCHEME` (`src/lib/payments/frisbii-signature.ts`) og skal rettes til den valgte udbyders dokumentation. Signerer udbyderen ikke selve body'en (Reepays gamle skema: `timestamp + id`), må body'en ikke stoles på – hent da begivenheden via udbyderens API ud fra id'et.
- **inMobile-webhook (M-7):** afklar om inMobile kan signere webhooks eller sende en custom header (`x-webhook-secret`); ellers bruges `?secret=` i URL'en (hold den ude af proxy-logs, rotér med `INMOBILE_WEBHOOK_SECRET_PREVIOUS`).
- **Whereby og CSP:** `frame-src https://*.whereby.com` og Permissions-Policy med samme wildcard skal verificeres mod jeres faktiske Whereby-subdomæne (kan låses til ét domæne).
- **S3 direkte upload (H-5):** bucketten skal have CORS for `POST` fra `APP_URL`, og presigned POST med `content-length-range` skal verificeres mod Hetzner Object Storage. Hvis POST-policies ikke understøttes: presigned PUT med efterfølgende størrelsestjek (finalize tjekker allerede størrelse og magic bytes).
- **Onboarding trin 6 (M-1, rest):** trin 1 afslører ikke længere, om en e-mail har en konto, men i trin 6 kan man stadig skelne (ny konto → betaling; eksisterende → «tjek din e-mail»). En fuld løsning kræver e-mailbekræftelse, før kontoen oprettes.
- **Login-spærring:** en angriber, der kender en e-mail, kan spærre kontoen i 15 min (og eskalerende). Indbygget i pr.-konto-spærring; nulstilling af adgangskoden ophæver spærringen. Overvåg `auth.lockout` i audit-loggen.
- **CSP:** `style-src` tillader `'unsafe-inline'` (inline style-attributter, fx bredden på fremdriftslinjer); scripts er nonce-låst. Kan strammes ved at erstatte style-attributter med CSS-variabler. Alle sider renderes dynamisk pga. noncen.
- **npm audit (kun udviklingsværktøjer):** `braces`/`micromatch`/`fast-glob` og `postcss-selector-parser` via Tailwind 3 og ESLint-plugins (bruges kun ved build/lint, ikke i produktionsbundlen). Rettes ved migrering til Tailwind 4. `npm audit --omit=dev` er ren.
- **Renovate og GitHub:** installér Renovate-appen på repoet, slå branch-beskyttelse til på `main` (kræv CI grøn) og secret scanning.
- **Konsol-adaptere (kun udvikling):** loggen maskerer alle 8-cifrede tal (også CVR-numre i firmanavne) – bevidst konservativt.
- **Kontrast:** endelig godkendelse af ejeren; mellemvej beskrevet i `docs/screens/kontrast/README.md`.
