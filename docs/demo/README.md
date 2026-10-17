# Demo

Optagelse af hele flowet i den nuværende app (designmanual, officielt logo, onboarding-test, board builder og CMS) med mock-leverandører for betaling, video og transskribering. Varighed ca. 2 min. 30 s, 1440x900.

![Demo](demo.gif)

Video i fuld opløsning: [demo.mp4](demo.mp4) (H.264, yuv420p, faststart)

| Trin | |
|---|---|
| 1. Forside og prisberegner med «fra»-priser | ![](step01.png) |
| 2. Trin 3: virksomhedskort fra CVR-registret | ![](step02.png) |
| 3. Trin 4: testen, ét spørgsmål ad gangen | ![](step03.png) |
| 4. Trin 5: foreslået board med tags, dækning, frekvens og pris; udskiftning fra kataloget | ![](step04.png) |
| 5. Trin 6: konto, samtykke og resumé; mock-betaling og dashboard | ![](step05.png) |
| 6. Kunden booker et møde i ugevisningen | ![](step06.png) |
| 7. Rådgiveren viser tilgængelighed | ![](step07.png) |
| 8. Rådgiverens møder | ![](step08.png) |
| 9. Afholdt møde med optagelse: transskription og resumé | ![](step09.png) |
| 10. Admin-CMS: forhåndsvisning med foreslået board efter ændret tag-vægt | ![](step10.png) |
| 11. Admin-CMS: omrokering af spørgsmål med træk-grebet | ![](step11.png) |
| 12. Admin sætter en rådgivers pris | ![](step12.png) |

Optagelsen er lavet med Playwright mod en frisk database (seed) og `next start`. Et møde sættes i fortiden via SQL, før optagelsen uploades.
