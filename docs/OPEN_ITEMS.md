# Åbne punkter – Advisory Board Unlimited

Appen kører fuldt lokalt i mock-tilstand (betaling, video, transskribering, e-mail og lager er simuleret). Nedenfor er hvad der mangler for at gå i produktion.

## 1. Konti der skal oprettes

| # | Leverandør | Land | Formål | Hvad skal sættes op | Env-variabler |
|---|---|---|---|---|---|
| 1 | **Frisbii** (tidl. Reepay) – frisbii.com | DK | Månedligt abonnement, kort + MobilePay | Erhvervskonto + indløsningsaftale. Opret 9 planer med handles `abu-2a-4w`, `abu-3a-4w`, `abu-4a-4w`, `abu-2a-8w`, … `abu-4a-12w` og priserne fra tabellen nedenfor. Opret webhook til `https://<domæne>/api/webhooks/payments`. | `PAYMENT_PROVIDER=frisbii`, `FRISBII_PRIVATE_KEY`, `FRISBII_WEBHOOK_SECRET` |
| 2 | **Whereby Embedded** – whereby.com | NO (EØS) | Videomøder med cloud-optagelse | Embedded-abonnement (et abonnement der inkluderer optagelse). Konfigurér optagelse til egen S3-bucket og webhook til `https://<domæne>/api/webhooks/video`. Indgå databehandleraftale. | `VIDEO_PROVIDER=whereby`, `WHEREBY_API_KEY`, `WHEREBY_WEBHOOK_SECRET` |
| 3 | **Mistral AI** – console.mistral.ai | FR | Transskribering (Voxtral) + mødereferat | API-konto. Vælg EU-hosting og slå træning på data fra. Indgå databehandleraftale. | `TRANSCRIPTION_PROVIDER=mistral`, `MISTRAL_API_KEY` |
| 4 | **Hetzner Cloud** – hetzner.com (alternativt Simply.com VPS) | DE / DK | Server til app + PostgreSQL | En server, f.eks. CX32 i Falkenstein/Nürnberg, med Docker. Daglig backup af Postgres. | `DATABASE_URL`, `APP_URL` |
| 5 | **Hetzner Object Storage** | DE | Midlertidig lagring af optagelser | Bucket + adgangsnøgler | `STORAGE_PROVIDER=s3`, `S3_*` |
| 6 | **E-mail (SMTP)** – Simply.com mail eller Brevo | DK / FR | Invitationer, nulstilling af password | Afsenderadresse, f.eks. `noreply@<domæne>`, med SPF/DKIM/DMARC | `EMAIL_PROVIDER=smtp`, `SMTP_*` |
| 7 | **Domæne** – f.eks. via Simply.com | DK | | DNS-records peger på serveren. TLS via Caddy/Traefik med Let's Encrypt. | |

Simply.com er allerede koblet til denne session. Jeg kan oprette DNS-records og mailkonto, når domænet er valgt.

## 2. Beslutninger du skal tage

1. **Prisformel.** Jeg har brugt *rådgivere × 1.750 kr × (52 / uger) / 12*, ekskl. moms:

   | Frekvens | 2 rådgivere | 3 rådgivere | 4 rådgivere |
   |---|---|---|---|
   | Hver 4. uge | 3.792 | 5.688 | 7.583 |
   | Hver 8. uge | 1.896 | 2.844 | 3.792 |
   | Hver 12. uge | 1.264 | 1.896 | 2.528 |

   Alternativet er at regne med f.eks. "hver 4. uge = 1 møde/md." (3.500 kr for 2 rådgivere). Er priserne ekskl. moms?
2. **Mødelængde.** Standard er 2 timer (`MEETING_DURATION_MINUTES`).
3. **Hvem vælger rådgiverne?** Lige nu vælger kunden selv fra puljen, og admin kan ikke ændre det. Skal admin kunne tildele og udskifte rådgivere?
4. **Bindingsperiode og opsigelse.** Lige nu kan kunden opsige når som helst. Skal der være binding eller opsigelsesvarsel?
5. **Afbud.** Afbud senere end 48 timer før mødet tæller som brugt møde. Er det rigtigt?
6. **Opbevaring.** Optagelser slettes efter transskribering. Hvor længe skal transskriptioner gemmes?
7. **Honorering af rådgivere.** Der er ingen afregning eller rapport over afholdte møder pr. rådgiver endnu.

## 3. Juridisk / GDPR

- Udfyld privatlivspolitik og handelsbetingelser (`/privatliv`, `/vilkaar`). De er skabeloner med `[pladsholdere]` og bør gennemgås af en advokat.
- Databehandleraftaler med Frisbii, Whereby, Mistral, Hetzner og mailudbyder.
- Fortegnelse over behandlingsaktiviteter (art. 30) og en vurdering af, om optagelse og transskribering af møder kræver en konsekvensanalyse (DPIA).
- Samtykke til optagelse: alle deltagere ser en besked før de går ind i mødet. Overvej om det er nok, eller om der skal et eksplicit samtykke i kontrakten.

## 4. Kendte tekniske mangler

**Leverandør-integrationer skrevet efter dokumentation/hukommelse – ikke testet mod rigtige konti:**
- Frisbii: checkout-session, opsigelse, planskifte og webhook-format.
- Whereby: mødeoprettelse med optagelse til S3, webhook-format/signatur, og om Whereby kan skrive til Hetzners S3-endpoint.
- Mistral: feltnavne i transskriberings-API'et og grænser for filstørrelse/varighed. Store filer håndteres i hukommelsen.

**Docker og test:**
- Docker-image og `docker compose` er ikke bygget/testet (Docker var ikke tilgængelig i byggemiljøet). App, build og standalone-server er testet uden Docker.
- Ingen automatiske tests af server actions/HTTP-ruter. Hovedflowet er testet manuelt med Playwright: signup → abonnement → booking → møde → transskription.

**Mangler i funktionalitet:**
- Ingen påmindelses-e-mails før møder og ingen kalenderinvitationer (.ics).
- Når admin behandler en sletteanmodning, opsiges abonnementet ikke automatisk hos Frisbii.
- Ingen rykkerflow ved fejlet betaling ud over status "PAST_DUE".
- Ingen admin-UI til at oprette flere admins eller redigere kunder. Første admin kommer fra seed-scriptet – **skift standardpasswords**.
- Rate-limiting på login er i hukommelsen (ok med én server).
- Rådgiverfotos er eksterne URL'er; der er ingen upload.
- Møder der er afholdt uden optagelse markeres ikke automatisk som afholdt.

## 5. Leverandører der bevidst er fravalgt (amerikanske)
Stripe, Zoom/Teams/Daily, OpenAI/Deepgram/AssemblyAI, Vercel/AWS, Auth0/Clerk, SendGrid/Mailgun, Google Fonts/Analytics, Sentry. Next.js, Prisma og AWS S3-klienten bruges kun som open source-biblioteker, der kører på egen server. Der sendes ingen data til disse firmaer.
