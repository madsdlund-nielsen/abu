# Advisory Board Unlimited (ABU)

Advisory board som abonnement. Kunder vælger 2, 3 eller 4 rådgivere og en mødefrekvens (hver 4., 8. eller 12. uge),
betaler en fast månedspris, booker møder online og får transskription og resumé af hvert møde bagefter.

- Prisformel: `rådgivere × 1.750 kr. × (52 / uger) / 12`, afrundet til hele kroner (ekskl. moms) – se `src/lib/pricing.ts`.
- Roller: **Admin** (opretter rådgivere, tildeler boards, ser alt), **Rådgiver** (profil, tilgængelighed, møder), **Kunde** (tilmelding, abonnement, booking, møder).
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
| Admin | `admin@abu.local` | `Admin123!` |
| Kunde (aktivt abonnement: 3 rådgivere, hver 8. uge) | `kunde@abu.local` | `Kunde123!` |
| Rådgivere (4 stk., fx `mette.lindberg@abu.local`) | se `prisma/seed.ts` | `Raadgiver123!` |

Hele flowet virker i mock-tilstand: tilmelding → vælg plan → "betaling" → book → åbn mødet → upload optagelse (som
rådgiver/admin) → transskription og resumé vises på mødesiden. Mails (inkl. invitationslinks) skrives til serverloggen,
og invitationslinket vises også for admin i UI'et under *Admin → Rådgivere*.

Med Docker Compose (Postgres + migration + app):

```bash
cp .env.example .env
docker compose up --build
docker compose run --rm migrate npx tsx prisma/seed.ts   # valgfrit: demodata
```

### Scripts

| Kommando | Formål |
|---|---|
| `npm run dev` | Udviklingsserver |
| `npm run build` / `npm start` | Produktionsbuild (Next `standalone`) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Enhedstests (vitest): pris, slots, kvoteperioder, webhook-signaturer |
| `npm run db:migrate` | Ny migration under udvikling |
| `npm run db:deploy` | Anvend migrationer (produktion) |
| `npm run db:seed` | Seed-data |

## Design

Visuelt design følger `docs/design/designmanual.pdf`. Tokens ligger i `src/styles/design-tokens.css` og spejles i `tailwind.config.ts`
(brug `bg-navy`, `text-gold-dark` osv., aldrig hex i komponenter). Open Sans er selvhostet via `@fontsource/open-sans` (ingen Google Fonts).
Ordmærket er komponenten `src/components/logo.tsx`. Skærmbilleder: `docs/design/screens/`.

## Arkitektur

```
src/
  app/                 Next.js App Router (sider + server actions + API-ruter)
    (app)/             Indloggede sider: dashboard, subscribe, book, meetings, account, availability, profile
    admin/             Admin (kræver rollen ADMIN)
    api/webhooks/      payments (Frisbii) og video (Whereby)
    api/cron/          process-jobs (CRON_SECRET)
    actions/           Server actions (auth, subscription, meetings, advisor, admin, account)
  lib/
    pricing.ts         Prisformel og -tabel
    slots.ts           Ren funktion: ledige tider for et board (testet)
    quota.ts           Kvoteperioder, aflysningsregler (testet)
    booking.ts         Booking/aflysning med revalidering i DB-transaktion (advisory locks)
    auth.ts            Hashing (bcryptjs), DB-sessioner (SHA-256 af tilfældigt token), rate limit, invite/reset-tokens
    jobs.ts, pipeline.ts  DB-baseret jobkø (FOR UPDATE SKIP LOCKED) og transskriptions-pipeline
    payments/ video/ transcription/ email/ storage/   Adaptere med mock-implementering
  middleware.ts        Letvægts-gate (kræver session-cookie); rollekontrol sker i layouts/sider
prisma/                schema, migrationer, seed
```

**Adaptere.** Hver integration har et interface og en `mock`-implementering, valgt via miljøvariabel:
`PAYMENT_PROVIDER`, `VIDEO_PROVIDER`, `TRANSCRIPTION_PROVIDER`, `EMAIL_PROVIDER`, `STORAGE_PROVIDER`.
Eksterne API'er kaldes med almindelig `fetch` – ingen leverandør-SDK'er.

**Auth.** Ingen ekstern IdP. Adgangskoder hashes med bcrypt (cost 12). Sessioner ligger i databasen; cookien indeholder et
tilfældigt token, og databasen gemmer kun dets SHA-256. Cookien er `httpOnly`, `sameSite=lax` og `secure` bag HTTPS.
Rådgivere inviteres af admin og vælger selv adgangskode via et engangslink (7 dage).

**Booking.** Et tidspunkt tilbydes kun, hvis *alle* rådgivere i boardet er ledige (inden for en ugentlig regel, ingen blokering,
intet andet møde inkl. 30 min buffer). Vindue: 2 dage – 16 uger frem. Kvote: ét møde pr. periode (frekvens i uger regnet fra
abonnementets start), kun aktuel og næste periode kan bookes. Aflysning ≥ 48 t før start frigiver kvoten. Ved booking
tages advisory locks på abonnement og rådgivere, og alt valideres igen i transaktionen.

**Møder og transskription.** Mødesiden viser videorummet kun til deltagere (kunden, boardets rådgivere, admin) efter at
optagelsesnotits er accepteret. Optagelser (webhook fra videoudbyder eller manuel upload) går i jobkøen →
`transcribe()` → `summarize()` → vises på mødesiden. Optagelsen slettes efter transskription
(`DELETE_RECORDINGS_AFTER_TRANSCRIPTION`). Jobs behandles i processen og kan samles op via `GET/POST /api/cron/process-jobs`
med `Authorization: Bearer $CRON_SECRET` (kald fra fx cron hvert minut).

**GDPR.** Dataeksport (JSON) og sletningsanmodning under *Konto*; audit-log over admin-handlinger og adgang til
transskriptioner; samtykke ved tilmelding; ingen tredjeparts-analytics eller eksterne fonte.

## Leverandører og hvorfor

| Behov | Leverandør | Land | Bemærkning |
|---|---|---|---|
| Hosting (app + Postgres) | Hetzner Cloud eller Simply.com VPS | DE / DK | Docker-image + docker-compose |
| Abonnementsbetaling | Frisbii (tidl. Reepay) | DK | Hosted checkout + webhooks, MobilePay/kort |
| Videomøder | Whereby Embedded | NO (EØS) | REST-API til rum, cloud-optagelse til egen S3 |
| Optagelser | Hetzner Object Storage (S3) | DE | Brug `@aws-sdk/client-s3` kun som klientbibliotek |
| Transskription + resumé | Mistral AI (Voxtral + chat) | FR | Adapteren gør selvhostet Whisper muligt |
| Transaktionsmail | SMTP (Simply.com mail eller Brevo) | DK / FR | nodemailer, vilkårlig SMTP |

Valget er drevet af, at ingen amerikanske selskaber er databehandlere. Se `docs/PLAN.md` for den fulde plan.

## Aktivér rigtige leverandører

1. **Frisbii:** opret 9 planer med handle `abu-{rådgivere}a-{uger}w` (fx `abu-3a-8w`) og beløbene fra prissiden. Sæt
   `PAYMENT_PROVIDER=frisbii`, `FRISBII_PRIVATE_KEY`, `FRISBII_WEBHOOK_SECRET`, og peg webhook til `{APP_URL}/api/webhooks/payments`.
2. **Whereby:** `VIDEO_PROVIDER=whereby`, `WHEREBY_API_KEY`, `WHEREBY_WEBHOOK_SECRET`, optagelses-bucket (`WHEREBY_RECORDING_*`);
   webhook til `{APP_URL}/api/webhooks/video`.
3. **Storage:** `STORAGE_PROVIDER=s3` med `S3_*` (Hetzner Object Storage-endpoint, fx `https://fsn1.your-objectstorage.com`).
4. **Mistral:** `TRANSCRIPTION_PROVIDER=mistral`, `MISTRAL_API_KEY`.
5. **E-mail:** `EMAIL_PROVIDER=smtp` + `SMTP_*`, `EMAIL_FROM`.

## Deployment til Hetzner / Simply.com

1. Opret en Linux-VPS (Hetzner Cloud CX22 eller Simply.com VPS) i EU, installér Docker + Compose plugin.
2. Peg et domæne (A-record) på serveren; kør en reverse proxy med automatisk TLS (fx Caddy:
   `abu.example.dk { reverse_proxy localhost:3000 }`).
3. Klon repoet, `cp .env.example .env`, og sæt som minimum `APP_URL=https://abu.example.dk`, en stærk `POSTGRES_PASSWORD`,
   `CRON_SECRET` og de rigtige providers (se ovenfor).
4. `docker compose up -d --build` – `migrate`-servicen kører `prisma migrate deploy`, derefter starter appen.
5. Opret admin: kør seed én gang (`docker compose run --rm migrate npx tsx prisma/seed.ts`), log ind som `admin@abu.local`,
   **skift adgangskoden under Konto og slet/deaktiver demobrugerne**. (Alternativt opret admin direkte i databasen.)
6. Cron: `* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://abu.example.dk/api/cron/process-jobs`.
7. Backup: `pg_dump` af Postgres-volumen dagligt (fx til Hetzner Object Storage) samt backup af `uploads`-volumen, hvis `local`-storage bruges.

Hvis Postgres og app kører på to servere, sæt `DATABASE_URL` direkte i `.env` og fjern `postgres`-servicen fra compose-filen.

## Test

```bash
npm test          # pris, slots, kvote, webhook-signaturer
npm run lint && npm run typecheck && npm run build
```
