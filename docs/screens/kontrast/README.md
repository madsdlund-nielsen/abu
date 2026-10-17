# Kontrast – før og efter (QA #14, ejerens beslutning 17.10.2026)

Skærmbilleder i 1440 × 900 px af de samme skærme før og efter ændringen. Ændringen er lavet i design-tokens
(`src/styles/design-tokens.css`) og de fælles komponentklasser (`.btn`, `.eyebrow`, `::placeholder`) – ikke ad hoc i sider.

| Skærm | Før | Efter |
|---|---|---|
| Forside, hero + knapper | `foer-landing-hero.png` | `efter-landing-hero.png` |
| Forside, «Næste skridt»-CTA og navy-bånd | `foer-landing-cta.png` | `efter-landing-cta.png` |
| Onboarding trin 5 med sidepanel | `foer-onboarding-trin5.png` | `efter-onboarding-trin5.png` |
| CMS (Admin → Onboarding) | `foer-cms-onboarding.png` | `efter-cms-onboarding.png` |
| Login | `foer-login.png` | `efter-login.png` |

## Målte kontrastforhold (WCAG 2.1, relativ luminans)

Krav: 4,5:1 for almindelig tekst (knapper og eyebrows er 12–14 px fed = almindelig tekst), 3:1 for ikke-tekst (fokusramme, kanter).

| Element | Før | Kontrast før | Efter | Kontrast efter |
|---|---|---|---|---|
| Primærknap, tekst | hvid på guld `#b4965d` | **2,81:1** ✗ | charcoal `#1a2528` på guld | **5,57:1** ✓ |
| Primærknap, hover | hvid på guld-mørk `#a3854f` | **3,49:1** ✗ | charcoal på guld-mørk | **4,50:1** ✓ |
| Eyebrow på hvid | guld-mørk | **3,49:1** ✗ | navy `#263753` | **11,97:1** ✓ |
| Eyebrow på lysegrå `#eeeeee` | guld-mørk | **3,00:1** ✗ | navy | **10,32:1** ✓ |
| Eyebrow på navy-bånd | guld | **4,25:1** ✗ | guld en anelse lysere `#b89b65` | **4,51:1** ✓ |
| Eyebrow på charcoal | guld | 5,57:1 ✓ | `#b89b65` | 5,91:1 ✓ |
| Stepper, kommende trin (tal) | slate `#6d838a` på hvid | **3,99:1** ✗ | `#657a80` (slate, mørkere) | **4,52:1** ✓ |
| Pladsholdertekst i felter | slate på hvid | **3,99:1** ✗ | `#657a80` | **4,52:1** ✓ |
| Advarselstekst i CMS / link-hover | guld-mørk på hvid | **3,49:1** ✗ | «guld-blæk» `#81693c` | **5,22:1** ✓ (4,50:1 på grå) |
| Fokusramme (ikke-tekst) | guld-mørk på hvid/grå | 3,49 / 3,00:1 ✓ | uændret | 3,49 / 3,00:1 ✓ |

Uændret og allerede OK: brødtekst `#333` (12,63:1 på hvid), dæmpet tekst `#4e4e4e` (8,32:1 hvid / 7,17:1 grå), navy
overskrifter, navigation på charcoal (hvid 80 %), deaktiverede knapper (undtaget fra kravet).

## Vurdering

- **Knapperne (charcoal på guld)** læses tydeligt bedre og ser stadig ud som ABU: guldet er stadig fladen, og charcoal er
  selv en brandfarve. Knappen virker en anelse tungere og mere «trykt» end før – efter min vurdering et plus for en
  B2B-tjeneste. Anbefaling: behold.
- **Navy eyebrows på lyse flader** er langt mere læselige, men lyse sider mister lidt af den varme guldaccent; den bæres nu
  af guldstregen under overskrifterne og knapperne. Det er stadig on-brand (navy er hovedfarven), men lidt mere nøgternt.
  Anbefaling: behold. Savner I guldet, er en mellemvej at bruge «guld-blæk» `#81693c` til eyebrows på hvide flader
  (5,22:1 – stadig guldtone; men kun 4,50:1 på grå, så det er på grænsen der). Det er én linje i `design-tokens.css`
  (`--color-eyebrow`).
- De øvrige rettelser (stepper, pladsholdere, advarsler) er små tonejusteringer, man knap ser.
