# Plan: onboarding-test, rådgiverpriser og CMS

Bekræftet af ejer: prisformlen gælder, alle priser er ekskl. moms.

## 1. Rådgiverpriser
- `AdvisorProfile.pricePerMeetingDkk Int @default(1750)`, sættes af admin pr. rådgiver.
- Månedspris = round( sum(rådgivernes mødepriser) × (52 / uger) / 12 ). `src/lib/pricing.ts` får `monthlyPriceForBoard(prices[], weeks)`. Den eksisterende tabel gælder stadig, når alle koster 1.750 (testene beholdes).
- Prisen fastfryses ved køb: `SubscriptionAdvisor.pricePerMeetingDkk` (snapshot). Hvis admin ændrer en rådgivers pris, påvirker det kun nye abonnementer og planskift. Det står i admin-UI'et.
- Forsiden og /priser: prisberegneren viser "fra"-priser baseret på standardprisen 1.750 og forklarer, at den endelige pris afhænger af de valgte rådgivere.

## 2. Kompetence-tags
- `Tag(id, slug unique, name, description?, sortOrder, active)`.
- `AdvisorTag(advisorId, tagId)` erstatter `AdvisorProfile.expertise String[]` (migrér eksisterende værdier til tags i migrationen eller seed).
- Admin tildeler tags pr. rådgiver (multi-select på /admin/advisors/[id]). Rådgiveren ser sine tags på /profile, men kan ikke ændre dem.

## 3. Onboarding-flow (erstatter /signup og /subscribe for nye kunder)
Route: `/kom-i-gang` (redirect fra /signup). Tilstanden gemmes server-side i `OnboardingSession(id, tokenHash, step, data Json, answers Json, suggestedBoard Json, createdAt, expiresAt)` via et httpOnly cookie-token, så genindlæsning og tilbage-knap virker. Udløber efter 7 dage, og en oprydningsjob sletter udløbne sessioner (GDPR).
Trinindikator øverst: 1 Kontakt · 2 Virksomhed · 3 Bekræft · 4 Test · 5 Dit board · 6 Konto & betaling.

1. **Kontakt:** navn + e-mail. Valider format, og afvis e-mails, der allerede har en konto (med link til login).
2. **Virksomhed:** CVR-nummer (8 cifre, modulus-11-tjek) + telefonnummer (dansk/int. format).
3. **Bekræft virksomhed:** hent automatisk fra CVR-registret: navn, adresse, postnr/by, virksomhedsform, branchekode + tekst, startdato, antal ansatte (interval) og status. Vis det som et pænt kort. Kunden bekræfter eller går tilbage og retter CVR. Hvis opslaget fejler eller virksomheden er ophørt, vises en tydelig fejl. Kunden kan fortsætte med manuel indtastning af navn og adresse (markeres som "ikke verificeret" over for admin).
4. **Test:** et spørgsmål pr. skærm med fremdrift ("Spørgsmål 3 af 7"), tilbage/næste, single- eller multi-choice efter spørgsmålets type. Spørgsmål og svar kommer fra CMS (kun aktive, i sorteret rækkefølge).
5. **Dit board:** forslag med 2–4 rådgivere og et sidepanel (sticky på desktop, nederst/foldbart på mobil):
   - Hovedfeltet viser rådgiverkort (foto/initialer, navn, titel, kort bio, tags med de matchende fremhævet, pris pr. møde) og en kort begrundelse ("Matcher: Vækst, Finansiering").
   - Hvert kort har "Udskift". Det åbner kataloget (alle aktive rådgivere) med søgning og filtrering på tags og sorteret efter match-score, og man vælger en erstatning. Desuden "Tilføj rådgiver" (op til 4) og "Fjern" (mindst 2).
   - Sidepanel: boardets samlede tags (union, med markering af hvilke der dækker kundens behov fra testen, og eventuelle udækkede behov), frekvensvælger (hver 4./8./12. uge), månedspris, pris pr. møde for hele boardet, antal møder om året. Prisen opdateres med det samme ved hver ændring.
   - "Fortsæt" er deaktiveret, medmindre boardet har 2–4 rådgivere og en frekvens er valgt.
6. **Konto & betaling:** opret adgangskode, accepter vilkår og privatlivspolitik (samtykke gemmes) og se et resumé (board, frekvens, pris ekskl. moms + moms + inkl. moms). Derefter oprettes User + CustomerProfile (med CVR-data og testsvar som snapshot), og man sendes til betaling (eksisterende payment-adapter). Mock-tilstand aktiverer direkte. Efter betaling kommer kunden til dashboardet, og OnboardingSession slettes.

Eksisterende kunder: /account/subscription bruger samme board-builder-komponent (katalog + sidepanel) til at ændre board og frekvens.

## 4. Matching-algoritme (`src/lib/matching.ts`, ren funktion med tests)
- Hvert svar har tag-vægte `[{tagId, weight 1–5}]` og kan desuden have `boardSize` (2|3|4).
- Kundens behov = sum af vægte pr. tag over alle valgte svar.
- Rådgiver-score = sum af behov for de tags, rådgiveren har.
- Boardet vælges grådigt for komplementaritet: tag den højeste score, og nedskriv derefter tags, som boardet allerede dækker, til 30 % for de næste valg, så forslaget dækker bredt i stedet for at vælge tre ens profiler. Ved lige score vinder lavest pris, derefter alfabetisk.
- Størrelse: hvis et valgt svar har `boardSize`, bruges den største angivne værdi. Ellers tilføjes rådgivere, indtil de dækker mindst 80 % af den samlede behovsvægt, begrænset til 2–4 (standard 3).
- Kun aktive rådgivere med mindst ét tag tæller med. Returnerer board, scores, dækkede og udækkede behov og en begrundelse pr. rådgiver.

## 5. CMS for admin (`/admin/onboarding`)
- **Spørgsmål:** opret, rediger, slet (soft: inaktiv), sortér (op/ned), type single/multi, hjælpetekst, aktiv.
- **Svar pr. spørgsmål:** tekst, sortering, tag-vægte (vælg tag + vægt 1–5, flere pr. svar), valgfri board-størrelse.
- **Tags:** /admin/tags med opret, rediger og deaktivér, og visning af hvor mange rådgivere og svar der bruger hvert tag.
- **Forhåndsvisning:** admin kan gennemføre testen uden at oprette noget og se det foreslåede board og scores (debug-visning).
- **Validering/advarsler:** et aktivt spørgsmål skal have mindst 2 svar, et tag uden rådgivere giver en advarsel (behov der aldrig kan dækkes), og et svar uden tag-vægte giver en advarsel.
- Ændringer gælder straks for nye onboardinger. Gennemførte tests gemmer et snapshot af spørgsmåls- og svartekster, så historikken bevares.
- Admin kan se kundens testsvar og CVR-data på /admin/customers/[id].
- AuditLog på alle CMS-ændringer.
- Rådgiver-admin (/admin/advisors/[id]): rediger pris pr. møde, tags, aktiv.

## 6. CVR-opslag (`src/lib/cvr/`, adapter, `CVR_PROVIDER=mock|virk|cvrapi`)
- **virk** (anbefalet, Erhvervsstyrelsen, DK): "CVR-data – System til System" Elasticsearch-endpoint `http://distribution.virk.dk/cvr-permanent/virksomhed/_search` med basic auth (`CVR_VIRK_USERNAME`/`CVR_VIRK_PASSWORD`, adgang gives gratis ved ansøgning til Erhvervsstyrelsen). Query på `Vrvirksomhed.cvrNummer`. Map til en intern `CompanyInfo`-type. Felterne skal verificeres, når adgangen er på plads.
- **cvrapi** (cvrapi.dk, dansk, alternativ): `https://cvrapi.dk/api?search={cvr}&country=dk` med beskrivende User-Agent (`CVR_USER_AGENT`). Gratis kvote er begrænset.
- **mock:** en håndfuld faste demo-virksomheder plus en deterministisk fallback for ethvert gyldigt CVR. Ét CVR returnerer "ophørt", og ét giver "ikke fundet", så fejlvisninger kan testes.
- Rate-limit opslag pr. session/IP, og cache resultater i hukommelsen i 24 timer.

## 7. Betaling (Frisbii) med varierende pris
Faste planhåndtag pr. kombination virker ikke længere. Brug én plan pr. frekvens (`abu-4w`, `abu-8w`, `abu-12w`) og sæt beløbet pr. abonnement ved oprettelse (amount-override i øre, ekskl. moms med moms tillagt efter Frisbii-opsætningen). Markér det som "skal verificeres mod Frisbii API" i OPEN_ITEMS. Mock er uændret. Planskift genberegner beløbet.

## 8. Seed
- 10 tags, f.eks. Strategi, Vækst & salg, Finansiering & kapital, Økonomistyring, Ledelse & organisation, HR & rekruttering, Digitalisering & IT, Marketing & brand, Internationalisering, Generationsskifte & exit, Bæredygtighed/ESG, Jura & governance.
- 8 rådgivere med 2–4 tags hver og priser mellem 1.500 og 2.500 (de fleste 1.750).
- 6–7 spørgsmål med svar og vægte, f.eks.:
  - Hvad er jeres største udfordring?
  - Hvilken fase er virksomheden i?
  - Hvor vil I være om 3 år?
  - Hvilke områder mangler I kompetencer på? (multi)
  - Hvor stor er virksomheden?
  - Hvor bredt et board ønsker I? (sætter boardSize)
- Demo-kunden får et board, så eksisterende flows virker.

## 9. Kvalitet
- Unit-tests: pricing med individuelle priser, matching (komplementaritet, størrelse, tie-break, ingen tags), CVR-modulus-11 og mock-adapter, onboarding-trinvalidering (zod).
- Lint, typecheck, test og build skal gå igennem. Playwright gennem hele onboarding-flowet og CMS-redigering (redigér et svars vægt og se, at forslaget ændrer sig i forhåndsvisningen).
- Designmanualen gælder (tokens, radius 0, guld sparsomt). Sidepanelet er et "boksed panel", så det må bruge `shadow-panel`.
