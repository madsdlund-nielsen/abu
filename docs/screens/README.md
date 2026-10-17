# Skærmbilleder

Friske skærmbilleder af den nuværende app (Next.js 16 / Prisma 7), optaget i Chromium mod et produktionsbuild med mock-udbydere.
Desktop er 1440 × 900 (fuld side hvor det giver mening), mobil er 390 px bredt (2x). De ældre billeder ligger i `docs/legacy/`.

Nyt siden sidst: kontrastdesignet (charcoal tekst på guldknapper, navy eyebrows), manuel aktivering af rådgivere med klar-tjekliste,
notifikations-CMS, leads og redigerbare onboarding-tekster, mødets deltagelsesvindue, admin-udskiftning af rådgiver på ét møde,
danske helligdage og sikkerhedshærdning.

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

## Rådgiver (`raadgiver/`)

| Fil | Beskrivelse |
|---|---|
| `01-dashboard.png` | Rådgiverens dashboard med kommende møder. |
| `02-tilgaengelighed.png` | Faste ugentlige tidsrum og fravær. |
| `03-profil-telefon-og-tags.png` | Profil med mobilnummer til SMS og tildelte kompetence-tags. |
| `04-moeder.png` | Rådgiverens mødeoversigt. |

## Admin (`admin/`)

| Fil | Beskrivelse |
|---|---|
| `01-dashboard.png` | Admin-dashboard med nøgletal, booking og baggrundsjobs. |
| `02-opret-raadgiver-invitation.png` | Ny rådgiver oprettet som inaktiv, med invitationslink. |
| `03-raadgivere-med-inaktiv.png` | Rådgiverlisten, hvor den nyoprettede rådgiver er inaktiv med klar-tjekliste og Aktivér-knap. |
| `04-raadgiver-klar-til-aktivering.png` | Rådgiverdetalje med tjekliste og aktiveringsvalg, inkl. advarsel om det der mangler. |
| `05-deaktivering-advarsel.png` | Advarsel ved deaktivering af en rådgiver, der sidder i aktive boards. |
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
| `16-moede-detalje.png` | Admin-mødedetalje med deltagere, flyt og aflys. |
| `17-moede-erstatning-kandidater.png` | Udskiftning af en rådgiver på ét møde med rangerede kandidater. |
| `18-notifikationer-regler.png` | Notifikationer: regler pr. hændelse, kanal og modtager. |
| `19-notifikationer-skabelon-sms.png` | SMS-skabelon med live forhåndsvisning, tegn- og segmentzæller og testudsendelse. |
| `20-notifikationer-log.png` | Notifikationsloggen med planlagte og sendte beskeder. |
| `21-notifikationer-indstillinger.png` | Indstillinger: stille timer, afsendernavn, tilladte SMS-lande og opbevaring. |
| `22-leads.png` | Leads med trin, status og samtykke. |
| `23-helligdage.png` | Helligdage og lukkedage, der spærres for booking. |

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
