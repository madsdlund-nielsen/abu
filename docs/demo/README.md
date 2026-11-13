# Demovideo: Advisory Board Unlimited

Samlet demovideo af platformen til visning for en samarbejdspartner. Videoen er optaget i selve appen (ikke mockups) med et synligt musemarkør,
danske undertekster og et intro-kort til hvert kapitel.

- **Hele videoen:** [abu-demo-fuld.mp4](abu-demo-fuld.mp4) (H.264, yuv420p, faststart, 1440x900, 30 fps, CRF 22, uden lydspor)
- **Undertekster:** [abu-demo-fuld.srt](abu-demo-fuld.srt) (samme tekster som er brændt ind i videoen, med globale tidskoder)
- **Poster (åbningskortet):** [poster.png](poster.png)
- **Enkeltkapitler:** mappen [kapitler/](kapitler/), ét filmklip pr. kapitel inkl. kapitlets intro-kort
- **Udvalgte stillbilleder:** mappen [stills/](stills/)

**Samlet varighed: 8:04 (485 sekunder).** Åbningskort 5 s, afslutningskort 6 s og 7 kapitler. Længden skyldes, at alle syv kapitler er vist
i fuldt flow i roligt tempo (2-3 s pause på vigtige skærme) med undertekster, der vises mindst 2,5 s og højst ca. 15 tegn pr. sekund.

## Kapitler

Starttidspunktet er starten på kapitlets intro-kort.

| # | Kapitel | Start | Varighed | Fil | Indhold |
|---|---|---|---|---|---|
| 1 | [Velkommen](kapitler/01-velkommen.mp4) | 0:04 | 0:30 | 1.5 MB | Forsiden og værdiløftet, prisberegneren med «fra»-priser og sektionen «Data i EU». |
| 2 | [Kunden sætter sit board](kapitler/02-kunden-saetter-sit-board.mp4) | 0:34 | 1:38 | 4.0 MB | Tilmelding trin 1-6 (lead-boks med samtykke, CVR og telefon, CVR-virksomhedskort, test med enkelt- og flervalg), foreslået board med sidepanel (kompetencer, dækning, «Kan være ansvarlig»), udskiftning af rådgiver fra kataloget, skift af frekvens med live-pris, konto med samtykke til optagelse, mock-betaling og overblik med «Ansvarlig rådgiver». |
| 3 | [Booking og møder](kapitler/03-booking-og-moeder.mp4) | 2:13 | 1:03 | 1.8 MB | Login som kunde, ugevisning med blokerede helligdage og kvoteperiode, booking af møde med hele boardet, mødeside før åbning (nedtælling), åbent mødelokale og et afholdt møde med resumé (beslutninger og handlingspunkter) og transskription. |
| 4 | [Rådgiverens hverdag](kapitler/04-raadgiverens-hverdag.mp4) | 3:16 | 0:53 | 1.3 MB | Rådgiverens overblik («Du er ansvarlig rådgiver»), tilgængelighed med danske datofelter og fravær, profil med upload af profilbillede og møder. |
| 5 | [Rådgivere og boards](kapitler/05-administration.mp4) | 4:09 | 1:38 | 4.2 MB | Invitation af ny rådgiver, tjekliste der blokerer aktivering, udfyldning af tags, bio og billede og aktivering, fordeling af ansvarlige rådgivere med «Foreslå udligning», udskiftning af én rådgiver i ét møde (kandidater) og notifikationsloggen. |
| 6 | [Indhold og kommunikation](kapitler/06-indhold-og-kommunikation.mp4) | 5:48 | 1:16 | 4.0 MB | Onboarding-testen (træk for at sortere, tag-vægte, forhåndsvisning af foreslået board), redigerbare onboarding-tekster, notifikationsregler, SMS-skabelon med live forhåndsvisning og tegntæller, testudsendelse, log og leads med samtykke. |
| 7 | [Sikkerhed og drift](kapitler/07-sikkerhed-og-drift.mp4) | 7:04 | 0:54 | 2.3 MB | Admin-login med MFA-kode og «husk denne enhed», betroede enheder, invitation af administrator med frisk kode, GDPR-dataeksport samt data i EU og adgang håndhævet i databasen (RLS). |

Åbningskort 0:00 og afslutningskort (7:58) rammer videoen ind. Afslutningskortet siger: «Advisory Board Unlimited – dit eget advisory board som abonnement» og
nævner, at der kun bruges europæiske leverandører, at data ligger i EU, GDPR-dataeksport og -sletning samt at adgang håndhæves i selve databasen.

## Logins og data i optagelsen

Optaget lokalt mod en frisk database (`abu_demo6`, migreret og seedet efter README'ens lokale opsætning) med appen kørende som `abu_app` med signeret RLS-kontekst,
bygget til produktion men startet med `APP_ENV=development`.

| Rolle | Login | Bruges i |
|---|---|---|
| Ny kunde (oprettes i videoen) | `anna@nordlys.dk`, CVR `30000102` (fiktiv mock-virksomhed) | kapitel 2 |
| Kunde (seed) | `kunde@abu.local` / `Kunde12345!` | kapitel 3 |
| Rådgiver (seed, ansvarlig rådgiver) | `camilla.nielsen@abu.local` / `Raadgiver123!` | kapitel 4 |
| Admin (seed) | `admin@abu.local` / `Admin12345!` + TOTP-kode fra den offentlige, kun-lokale udviklingshemmelighed (se README). Koden udregnes i optagelsesscriptet og vises, når den tastes. | kapitel 5-7 (kapitel 5 og 6 starter med en allerede oprettet admin-session) |

Forberedte demodata (via UI og SQL før optagelsen):

- Otte rådgivere med profilbilleder. Billederne er lokalt genererede neutrale, monokrome silhuetter (ingen fotos af rigtige personer) og uploadet gennem appens egen upload.
- Et afholdt møde for den seedede kunde med transskription og resumé (hovedpunkter, beslutninger, handlingspunkter), samt et kommende møde hos en anden kunde til udskiftningsscenen.
- Tre ekstra kunder med boards, så fordelingen af ansvarlige rådgivere er skæv, og «Foreslå udligning» har noget at foreslå.
- Syv leads fra tilmeldingens trin 1 (fem med markedsføringssamtykke, to uden). Seks er forberedt, og Anna fra kapitel 2 er den syvende.
- En rådgiver (Rasmus Ravn), der er inviteret, har accepteret og lagt tilgængelighed ind, til aktiveringsscenen. Katrine Vestergaard inviteres live og viser, at tjeklisten blokerer.
- Helligdage: booking-ugen (28. dec.-3. jan.) viser nytårsaften og nytårsdag som blokerede.
- Tidspunktet for det nyligt bookede møde flyttes via SQL til «lige startet», så mødelokalet kan vises åbent (kun til demoen).

## Udbydere er mocket

Alle eksterne udbydere kører i mock-tilstand, så der sendes ingen rigtige beskeder, og der trækkes ingen penge:

- **Betaling:** `PAYMENT_PROVIDER=mock`. Siden «Betaling (testtilstand)» og knappen «Gennemfør testbetaling» er appens egen mock.
- **Video:** `VIDEO_PROVIDER=mock`. Mødelokalet viser en pladsholder («Videorummet vises her»).
- **Transskription og resumé:** mock. Resuméet og transskriptionen i kapitel 3 er forberedt demodata, ikke et rigtigt AI-resultat.
- **E-mail og SMS:** `EMAIL_PROVIDER=console` og `SMS_PROVIDER=console`. Beskeder skrives til serverloggen og til notifikationsloggen, og invitationslinks vises i UI'et, fordi e-mail ikke sendes.
- **CVR-opslag:** mock-registret (fiktive virksomheder).

Intet i optagelsen er rigtige kundedata. Invitationslinks og adgangskoder i videoen hører til en kortlivet lokal demodatabase.

## Teknik

Optaget med Playwright (Chromium, 1440x900, deviceScaleFactor 1) med en indsprøjtet musemarkør og undertekstbjælke (CSS via CSSOM, ingen inline-scripts, så appens CSP
med nonces er uændret). Hvert kapitel er optaget for sig, derefter samlet med ffmpeg med korte overblændinger (0,4 s). Intro-kortene er HTML med den selvhostede Open Sans
og de officielle logoer fra `public/brand/`, uden eksterne anmodninger.
