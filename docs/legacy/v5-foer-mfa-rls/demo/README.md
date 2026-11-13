# Demo af Advisory Board Unlimited

Ca. 3 minutters gennemgang af den nuværende app, optaget i Chromium mod et produktionsbuild med mock-udbydere (betaling, video, transskription, e-mail og SMS). Hver scene har en caption-bjælke i brandets stil.

![Demo](demo.gif)

[Se videoen i fuld kvalitet (demo.mp4)](demo.mp4) · H.264, 1440 × 900, ca. 3:06.

## Historien

1. **Forside og prisberegner** – antal rådgivere og mødefrekvens ændrer prisen med det samme.
2. **Onboarding** – kontakt med samtykkeboks (lead), CVR og telefon, CVR-kort, testen (inkl. flervalg), boardforslag med sidebar, udskiftning fra kataloget, ændret frekvens (prisen opdateres), konto med optagelsessamtykke, testbetaling og dashboard.
3. **Booking** – ugevisning, og en uge hvor Juleaftensdag og juledag er spærret som helligdage.
4. **Aktivering af rådgiver** – admin inviterer en ny rådgiver (inaktiv), tildeler tags, kunden kan ikke finde vedkommende i kataloget, admin aktiverer via klar-tjeklisten, og rådgiveren kan nu findes.
5. **Udskiftning på ét møde** – pludseligt fravær: admin udskifter en rådgiver, og beskederne ses i notifikationsloggen.
6. **Mødesiden** – åbent vindue med videorummet vist direkte (ingen accept-skranke), derefter et afholdt møde med resumé og transskription.
7. **Admin-CMS** – træk og slip af spørgsmål, ændring af svarvægt, forhåndsvisning, redigering af en SMS-skabelon med live preview og segmentzæller, og testudsendelse.
8. **Afslutning.**

## Trin og nøglebilleder

| Billede | Tid | Beskrivelse |
|---|---|---|
| [`step01.png`](step01.png) | 0:03 | Forsiden |
| [`step02.png`](step02.png) | 0:08 | Prisberegneren på forsiden |
| [`step03.png`](step03.png) | 0:14 | Trin 1: kontakt og samtykkeboks |
| [`step04.png`](step04.png) | 0:20 | Trin 3: CVR-kort |
| [`step05.png`](step05.png) | 0:23 | Trin 4: enkeltvalg |
| [`step06.png`](step06.png) | 0:29 | Trin 4: flervalg |
| [`step07.png`](step07.png) | 0:37 | Trin 5: boardforslag med sidebar |
| [`step08.png`](step08.png) | 0:39 | Rådgiverkatalog |
| [`step09.png`](step09.png) | 0:42 | Pris ved hver 4. uge |
| [`step10.png`](step10.png) | 0:49 | Trin 6: konto og optagelsessamtykke |
| [`step11.png`](step11.png) | 0:55 | Kundens dashboard |
| [`step12.png`](step12.png) | 0:59 | Booking i ugevisning |
| [`step13.png`](step13.png) | 1:04 | Helligdag spærret i bookingen |
| [`step14.png`](step14.png) | 1:09 | Mødet er booket |
| [`step15.png`](step15.png) | 1:18 | Ny rådgiver inviteret |
| [`step16.png`](step16.png) | 1:22 | Inaktiv rådgiver med tjekliste |
| [`step17.png`](step17.png) | 1:35 | Inaktiv rådgiver findes ikke i kataloget |
| [`step18.png`](step18.png) | 1:41 | Aktivering med tjekliste og advarsel |
| [`step19.png`](step19.png) | 1:53 | Aktiveret rådgiver findes i kataloget |
| [`step20.png`](step20.png) | 1:59 | Erstatningskandidater |
| [`step21.png`](step21.png) | 2:05 | Rådgiver udskiftet på mødet |
| [`step22.png`](step22.png) | 2:10 | Notifikationslog |
| [`step23.png`](step23.png) | 2:16 | Mødeside med åbent rum |
| [`step24.png`](step24.png) | 2:24 | Resumé og transskription |
| [`step25.png`](step25.png) | 2:35 | Træk og slip af spørgsmål |
| [`step26.png`](step26.png) | 2:40 | Svarvægt ændret |
| [`step27.png`](step27.png) | 2:47 | Forhåndsvisning af testen |
| [`step28.png`](step28.png) | 2:54 | SMS-skabelon med live preview og tegnzæller |
| [`step29.png`](step29.png) | 2:58 | Testbesked sendt |
| [`step30.png`](step30.png) | 3:05 | Afslutning |

## Sådan er det optaget

Scenerne er optaget med Playwright (Chromium, 1440 × 900) mod en frisk database (`abu_shots2`) og samlet med ffmpeg. Mødet i scene 6 flyttes til nutid og derefter til fortiden med SQL, så mødevinduets to tilstande kan vises; transskription og resumé er mock-udbyderens. Scripts holdes uden for repoet.

## Efter totrinsbekræftelse (19.10.2026)

Demoen er optaget før totrinsbekræftelse blev påkrævet for administratorer. Optages den igen, logger seed-admin (`admin@abu.local`)
ind med adgangskoden og derefter en kode beregnet ud fra den kun-lokale TOTP-hemmelighed i README (RFC 6238, SHA-1, 6 cifre, 30 sek.).
Et tidstrin kan kun bruges én gang, så vent til næste 30-sekunders trin mellem to logins. Nye administratorer opsætter MFA på
`/mfa/opsaet` (scriptet læser hemmeligheden fra `[data-testid=mfa-secret]`). Følsomme admin-handlinger (fx sletning af en kunde og
udligning af ansvarlige) kræver en kode, der højst er 15 minutter gammel.
