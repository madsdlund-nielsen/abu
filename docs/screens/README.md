# Skærmbilleder

Friske skærmbilleder af den nuværende app (Next.js 16 / Prisma 7), optaget i Chromium mod et produktionsbuild med mock-udbydere.
Desktop er 1440 × 900 (fuld side hvor det giver mening), mobil er 390 px bredt (2x). De ældre billeder ligger i `docs/legacy/`.

Nyt siden sidst: kontrastdesignet (charcoal tekst på guldknapper, navy eyebrows), manuel aktivering af rådgivere med klar-tjekliste,
notifikations-CMS, leads og redigerbare onboarding-tekster, mødets deltagelsesvindue, admin-udskiftning af rådgiver på ét møde,
danske helligdage og sikkerhedshærdning.

Opdateret 18.10.2026 (ejerens beslutninger): aktivering er blokeret, indtil tjeklisten er opfyldt, og status ændres med en
dedikeret knap (`admin/03`–`05`, `04b`, `04c`); møder holdes altid med hele boardet (`admin/16`, `17`); hvert board har en
ansvarlig rådgiver (`admin/24`, `25`, `onboarding/11`, `12`, `kunde/09`). Rådgiverfotos uploades nu i stedet for en
foto-URL (`raadgiver/03`, `admin/04c`, `onboarding/13`); testbillederne er genererede portrætter (ingen rigtige personer). Øvrige billeder er fra før disse ændringer og viser
fx board-builderen uden markøren «Kan være ansvarlig».

Opdateret 19.10.2026: platform-administratorer og totrinsbekræftelse (`admin/30`–`40`, `konto/`, `mobil/09`), optaget mod en frisk
database (`abu_mfa`: migrate deploy + seed + `create-admin` for `mads@qlim8.com`). TOTP-koderne er beregnet i Playwright-scriptet ud fra
hemmeligheden på opsætningssiden; ingen CSP-fejl i konsollen.

## Offentlig (`offentlig/`)

| Fil | Beskrivelse |
|---|---|
| `01-forside.png` | Forsiden med hero, sådan virker det og prisberegner. |
| `02-priser.png` | Prissiden med pristabel og beregner. |
| `03-login.png` | Loginformularen. |
| `04-privatliv.png` | Privatlivspolitikken (skabelon). |
| `05-vilkaar.png` | Vilkår (skabelon). |
| `06-404-siden-findes-ikke.png` | 404-siden i brandets stil. |

## Onboarding (`onboarding/`)

| Fil | Beskrivelse |
|---|---|
| `01-trin1-kontakt-og-samtykke.png` | Trin 1: navn, e-mail og det aktive samtykkefelt til kontakt (lead). |
| `02-trin2-cvr-og-telefon.png` | Trin 2: CVR-nummer og telefonnummer. |
| `03-trin3-cvr-virksomhedskort.png` | Trin 3: virksomhedskortet hentet fra CVR-registret. |
| `04-trin4-test-enkeltvalg.png` | Trin 4: testspørgsmål med ét svar. |
| `05-trin4-test-flervalg.png` | Trin 4: testspørgsmål med flere svar. |
| `06-trin5-boardbygger-hel-side.png` | Trin 5: boardbyggeren i fuld side med dækning og pris. |
| `07-trin5-katalog-aaben.png` | Trin 5: rådgiverkataloget åbent ved udskiftning. |
| `08-trin5-efter-udskiftning.png` | Trin 5: boardet efter udskiftning af en rådgiver. |
| `09-trin6-konto-og-optagelsessamtykke.png` | Trin 6: konto, vilkår og samtykke til optagelse med momsresumé. |
| `10-mock-betaling.png` | Testbetalingen (mock-udbyder), som aktiverer abonnementet. |
| `11-trin5-kan-vaere-ansvarlig.png` | Trin 5: rådgivere med lead-tagget er markeret «Kan være ansvarlig», og sidepanelet viser «Ansvarlig rådgiver: Tildeles automatisk». |
| `12-trin5-ingen-ansvarlig-blokeret.png` | Trin 5: ingen i boardet kan være ansvarlig – Fortsæt er spærret med en forklaring. |
| `13-trin5-raadgiverfotos.png` | Trin 5 før login: rådgiverkortene viser de uploadede fotos (96 px-miniaturer fra `/api/avatar`); rådgivere uden foto vises med initialer. |

## Kunde (`kunde/`)

| Fil | Beskrivelse |
|---|---|
| `01-dashboard.png` | Kundens dashboard lige efter oprettelsen. |
| `01b-dashboard-med-kommende-moede.png` | Dashboardet med et booket, kommende møde. |
| `02-booking-ugevisning.png` | Booking i ugevisning med ledige tider hvor hele boardet er ledigt. |
| `03-booking-helligdag-spaerret.png` | Ugen op til jul: Juleaftensdag og juledag er spærret for booking. |
| `04-moede-ikke-aaben-endnu-nedtaelling.png` | Mødesiden før mødet åbner, med nedtælling til åbningstidspunktet. |
| `05-moede-aabent-med-rum.png` | Mødesiden når vinduet er åbent: videorummet vises direkte uden accept. |
| `06-moede-afsluttet-transskription-og-resume.png` | Afholdt møde med resumé og transskription. |
| `07-konto-abonnement.png` | Abonnement: nuværende plan og skift af board og frekvens. |
| `08-konto-notifikationer-fravalg.png` | Konto med fravalg af e-mail, SMS og markedsføring. |
| `09-dashboard-ansvarlig-raadgiver.png` | Ny kunde efter køb: den mindst belastede kvalificerede rådgiver er tildelt som «Ansvarlig rådgiver». |

## Rådgiver (`raadgiver/`)

| Fil | Beskrivelse |
|---|---|
| `01-dashboard.png` | Rådgiverens dashboard med kommende møder. |
| `02-tilgaengelighed.png` | Faste ugentlige tidsrum og fravær. |
| `03-profil-telefon-og-tags.png` | Min profil: rådgiveren har uploadet et mobilfoto (med EXIF-GPS og orientering i originalen – billedet er roteret opret, beskåret til kvadrat, og metadata er fjernet) med «Skift billede»/«Fjern billede», mobilnummer til SMS og tildelte kompetence-tags. |
| `04-moeder.png` | Rådgiverens mødeoversigt. |

## Admin (`admin/`)

| Fil | Beskrivelse |
|---|---|
| `01-dashboard.png` | Admin-dashboard med nøgletal, booking og baggrundsjobs. |
| `02-opret-raadgiver-invitation.png` | Ny rådgiver oprettet som inaktiv, med invitationslink. |
| `03-raadgivere-med-inaktiv.png` | Rådgiverlisten med gemt status (AKTIV/INAKTIV), kompakt tjekliste-indikator og interne tags; den nyoprettede rådgiver er INAKTIV, og «Aktivér» er spærret, til tjeklisten er opfyldt. |
| `04-raadgiver-klar-til-aktivering.png` | Tjeklisten er opfyldt: «Aktivér rådgiver» gemmer straks efter bekræftelse. |
| `04b-raadgiver-ikke-klar-blokeret.png` | Nyinviteret rådgiver: «Aktivér rådgiver» er spærret med listen over det, der mangler (serveren afviser det også). |
| `04c-raadgiver-profil-redigeret-af-admin.png` | Admin har skiftet rådgiverens profilbillede under «Profil» (titel, bio og mobilnummer rettes samme sted); tjeklisten viser «Profilbillede (valgfrit)» ✓, som ikke er et krav for aktivering. Rådgiveren kan selv rette det hele. |
| `05-deaktivering-advarsel.png` | Bekræftelse ved «Deaktivér», der lister kunder med aktive boards, som rådgiveren sidder i. |
| `06-onboarding-cms.png` | Onboarding-CMS: spørgsmål, svar og tag-vægte. |
| `07-onboarding-cms-traek-og-slip.png` | Træk og slip af et spørgsmål med den gyldne indsættelseslinje. |
| `08-onboarding-cms-forhaandsvisning.png` | Forhåndsvisning af testen med foreslået board og scores. |
| `09-onboarding-tekster.png` | Editor til onboardingens tekster med forhåndsvisning. |
| `10-tags.png` | Kompetence-tags med beskrivelse, antal rådgivere og aktiv-knap. |
| `11-kunder.png` | Kundeoversigten. |
| `12-kunder-ikke-verificeret.png` | Kundefilter «Ikke verificeret (manuelt indtastet)». |
| `13-kunde-detalje.png` | Kundedetalje med virksomhed, kontakt og abonnement. |
| `14-abonnementer.png` | Oversigt over abonnementer og deres boards. |
| `15-abonnement-fast-board.png` | Editor til kundens faste board med prisvalg ved ændring. |
| `16-moede-detalje.png` | Admin-mødedetalje: mødet holdes altid med hele boardet, så der er kun «Udskift» (ingen «Fjern») og «Tilføj ekstra deltager»; ansvarlig rådgiver vises. |
| `17-moede-erstatning-kandidater.png` | Udskiftning af en rådgiver på ét møde med rangerede kandidater (kun kompetence-tags). |
| `18-notifikationer-regler.png` | Notifikationer: regler pr. hændelse, kanal og modtager. |
| `19-notifikationer-skabelon-sms.png` | SMS-skabelon med live forhåndsvisning, tegn- og segmentzæller og testudsendelse. |
| `20-notifikationer-log.png` | Notifikationsloggen med planlagte og sendte beskeder. |
| `21-notifikationer-indstillinger.png` | Indstillinger: stille timer, afsendernavn, tilladte SMS-lande og opbevaring. |
| `22-leads.png` | Leads med trin, status og samtykke. |
| `23-helligdage.png` | Helligdage og lukkedage, der spærres for booking. |
| `24-ansvarlige-fordeling.png` | Ansvarlige rådgivere: fordeling pr. kvalificeret rådgiver og et udligningsforslag (board, fra → til), der kun anvendes efter bekræftelse. |
| `25-abonnement-ansvarlig.png` | Abonnement: admin har skiftet ansvarlig rådgiver (kun kvalificerede i boardet kan vælges). |
| `30-mfa-opsaetning-paakraevet.png` | Ny administrator (fra `create-admin`) efter valg af adgangskode: tvungen opsætning af totrinsbekræftelse. QR-koden er tegnet lokalt som SVG, nøglen vises i grupper til manuel indtastning; menuen er skjult, og alle andre sider omdirigerer hertil. |
| `31-mfa-gendannelseskoder.png` | Opsætningen er bekræftet med en kode: 10 gendannelseskoder vises én gang med «Download (.txt)» og «Jeg har gemt dem». |
| `32-login-kode-husk-enhed.png` | Login trin 2: koden fra appen (numerisk felt, sendes automatisk ved 6 cifre) og «Husk denne enhed i 30 dage». |
| `33-login-gendannelseskode.png` | Login med en gendannelseskode i stedet for appen. |
| `34-administratorer-invitation.png` | Admin → Administratorer: Anna er inviteret (status «Inviteret», MFA ikke opsat); linket vises, fordi e-mail kører i konsol-tilstand. |
| `35-administratorer-liste.png` | Listen med status, MFA, seneste login og betroede enheder; «Nulstil MFA» og «Deaktivér» – ikke på din egen række. |
| `36-administrator-deaktiveret.png` | Anna er deaktiveret: logget ud overalt og kan ikke logge ind igen. |
| `37-sidste-aktive-administrator.png` | Mads er den eneste aktive administrator: ingen kan deaktivere ham, og siden anbefaler at invitere en mere (nødprocedure: `create-admin --reset-mfa`). |
| `38-bekraeft-med-kode-kraeves.png` | Bekræftelsen er ældre end 15 minutter: handlingerne er spærret, til der er bekræftet med kode igen. |
| `39-bekraeft-med-kode.png` | `/mfa/bekraeft`: ny kode til følsomme handlinger; derefter tilbage til siden. |
| `40-notifikationer-administrator-inviteret.png` | Notifikationer: den låste udløser «Administrator inviteret» med sin redigerbare skabelon. |

## Konto og totrinsbekræftelse (`konto/`)

| Fil | Beskrivelse |
|---|---|
| `01-adgangskode-under-10-tegn-afvist.png` | Invitationslinket fra `create-admin`: en adgangskode på 8 tegn afvises af serveren (mindst 10 tegn) – ingen undtagelse fra politikken. |
| `02-totrin-og-betroede-enheder.png` | Konto for en administrator: MFA slået til, gendannelseskoder tilbage, betroede enheder med «Denne enhed», udløb (ingen forlængelse) og «Fjern». |
| `03-gendannelseskode-brugt.png` | Efter login med en gendannelseskode: beskeden om, at koden er brugt, og 9 af 10 tilbage. |
| `04-gendannelseskode-genbrug-afvist.png` | Samme gendannelseskode virker ikke igen. |
| `05-raadgiver-mfa-valgfri.png` | Rådgiverens konto: totrinsbekræftelse er valgfri og slået fra. |
| `06-raadgiver-opsaet-mfa.png` | Valgfri opsætning for en rådgiver («Ekstra sikkerhed», med «Annullér»). |
| `07-raadgiver-mfa-slaaet-til.png` | Rådgiverens MFA er slået til; kan slås fra igen med en kode. |

## Mobil, 390 px (`mobil/`)

| Fil | Beskrivelse |
|---|---|
| `01-forside.png` | Forsiden på mobil. |
| `02-onboarding-trin2.png` | Onboarding trin 2 på mobil. |
| `03-boardbygger-bundbjaelke-lukket.png` | Boardbyggeren med den sammenfoldede bundbjælke (pris og Fortsæt). |
| `04-boardbygger-bundbjaelke-aaben.png` | Boardbyggeren med bundbjælken foldet ud (frekvens og oversigt). |
| `05-booking.png` | Booking på mobil. |
| `06-moedeside-aaben.png` | Mødesiden med åbent videorum på mobil. |
| `07-admin-cms.png` | Onboarding-CMS i admin på mobil. |
| `08-admin-navigation.png` | Admin-navigationen foldet ud på mobil. |
| `09-mfa-kode.png` | Login trin 2 (kode fra appen) på mobil – ingen vandret scroll. |
