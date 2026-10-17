/* Seed-katalog: kompetence-tags, rådgivere og onboarding-test. Importeres også af enhedstests (worked example). */

export const TAGS = [
  { slug: "strategi", name: "Strategi", description: "Retning, forretningsmodel og prioritering" },
  { slug: "vaekst-salg", name: "Vækst & salg", description: "Salgsorganisation, pipeline og kundeanskaffelse" },
  { slug: "finansiering-kapital", name: "Finansiering & kapital", description: "Bankforhold, investorer og kapitalrejsning" },
  { slug: "oekonomistyring", name: "Økonomistyring", description: "Budget, likviditet og rapportering" },
  { slug: "ledelse-organisation", name: "Ledelse & organisation", description: "Ledelsesteam, kultur og organisering" },
  { slug: "hr-rekruttering", name: "HR & rekruttering", description: "Rekruttering, fastholdelse og lønstruktur" },
  { slug: "digitalisering-it", name: "Digitalisering & IT", description: "Systemer, data, AI og teknologivalg" },
  { slug: "marketing-brand", name: "Marketing & brand", description: "Positionering, brand og markedsføring" },
  { slug: "internationalisering", name: "Internationalisering", description: "Eksport og nye markeder" },
  { slug: "generationsskifte-exit", name: "Generationsskifte & exit", description: "Ejerskifte, salg og overdragelse" },
  { slug: "baeredygtighed-esg", name: "Bæredygtighed/ESG", description: "Rapportering og grøn omstilling" },
  { slug: "jura-governance", name: "Jura & governance", description: "Ejeraftaler, bestyrelsesarbejde og compliance" },
] as const;

export interface SeedAdvisor {
  name: string;
  email: string;
  title: string;
  bio: string;
  price: number;
  tags: string[];
}

export const ADVISORS: SeedAdvisor[] = [
  {
    name: "Mette Lindberg",
    email: "mette.lindberg@abu.local",
    title: "Tidligere CFO, børsnoteret industrikoncern",
    bio: "Mette har 20 års erfaring som økonomichef og bestyrelsesmedlem. Hun hjælper med likviditetsstyring, finansiering og kapitalrejsning.",
    price: 2250,
    tags: ["finansiering-kapital", "oekonomistyring", "strategi"],
  },
  {
    name: "Jesper Holm Andersen",
    email: "jesper.andersen@abu.local",
    title: "Salgsdirektør og iværksætter",
    bio: "Jesper har opbygget salgsorganisationer i tre skalerende B2B-virksomheder. Fokus på pipeline, prissætning og kundeanskaffelse.",
    price: 1750,
    tags: ["vaekst-salg", "internationalisering"],
  },
  {
    name: "Camilla Strøm Nielsen",
    email: "camilla.nielsen@abu.local",
    title: "CTO og digital transformation",
    bio: "Camilla har ledet tech-teams på 5 til 150 medarbejdere og rådgiver om produktstrategi, arkitektur og AI i forretningen.",
    price: 1750,
    tags: ["digitalisering-it", "strategi"],
  },
  {
    name: "Søren Bjerregaard",
    email: "soeren.bjerregaard@abu.local",
    title: "HR-direktør og organisationsudvikler",
    bio: "Søren hjælper ledelser med rekruttering, kultur og ledelsesudvikling – især i virksomheder i hurtig vækst.",
    price: 1750,
    tags: ["hr-rekruttering", "ledelse-organisation"],
  },
  {
    name: "Lars Thorup Vinter",
    email: "lars.vinter@abu.local",
    title: "Tidligere CEO og bestyrelsesformand",
    bio: "Lars har været administrerende direktør i to familieejede industrivirksomheder og har gennemført tre virksomhedssalg. Han sparrer om retning, ejerskab og exit.",
    price: 2500,
    tags: ["strategi", "generationsskifte-exit", "ledelse-organisation"],
  },
  {
    name: "Ingrid Skov Pedersen",
    email: "ingrid.pedersen@abu.local",
    title: "Advokat og bestyrelsesrådgiver",
    bio: "Ingrid rådgiver ejerledede virksomheder om ejeraftaler, bestyrelsesarbejde og transaktioner, og hjælper med at gøre governance enkel og brugbar.",
    price: 2000,
    tags: ["jura-governance", "generationsskifte-exit", "finansiering-kapital"],
  },
  {
    name: "Nikolaj Brandt",
    email: "nikolaj.brandt@abu.local",
    title: "Bæredygtighedsdirektør",
    bio: "Nikolaj har ansvaret for ESG-rapportering og grøn omstilling i en eksporterende fødevarekoncern, og hjælper med at gøre bæredygtighed til forretning.",
    price: 1500,
    tags: ["baeredygtighed-esg", "internationalisering", "strategi"],
  },
  {
    name: "Louise Kjær Hansen",
    email: "louise.hansen@abu.local",
    title: "CMO og brandstrateg",
    bio: "Louise har bygget brands og marketingfunktioner i scale-ups og rådgiver om positionering, kanalvalg og målbar vækst.",
    price: 1750,
    tags: ["marketing-brand", "vaekst-salg", "digitalisering-it"],
  },
];

export interface SeedAnswer {
  text: string;
  boardSize?: 2 | 3 | 4;
  weights: Record<string, number>;
}
export interface SeedQuestion {
  text: string;
  helpText?: string;
  type: "SINGLE" | "MULTI";
  answers: SeedAnswer[];
}

export const QUESTIONS: SeedQuestion[] = [
  {
    text: "Hvad er jeres største udfordring lige nu?",
    helpText: "Vælg det, der fylder mest i ledelsen i dag.",
    type: "SINGLE",
    answers: [
      { text: "Vi vil vækste hurtigere", weights: { "vaekst-salg": 5, "marketing-brand": 2, strategi: 2 } },
      { text: "Vi mangler kapital eller overblik over økonomien", weights: { "finansiering-kapital": 5, oekonomistyring: 4 } },
      { text: "Organisationen og ledelsen skal følge med", weights: { "ledelse-organisation": 5, "hr-rekruttering": 3 } },
      { text: "Vores systemer og processer er bagud", weights: { "digitalisering-it": 5, strategi: 1 } },
      { text: "Vi skal planlægge ejerskifte eller exit", weights: { "generationsskifte-exit": 5, "jura-governance": 3, "finansiering-kapital": 2 } },
    ],
  },
  {
    text: "Hvilken fase er virksomheden i?",
    type: "SINGLE",
    answers: [
      { text: "Opstart – vi finder stadig vores forretningsmodel", weights: { "vaekst-salg": 2, "finansiering-kapital": 3, strategi: 2 } },
      { text: "Skalering – vi vokser hurtigt", weights: { "vaekst-salg": 3, "ledelse-organisation": 3, "digitalisering-it": 2 } },
      { text: "Moden og stabil", weights: { strategi: 3, oekonomistyring: 2, "baeredygtighed-esg": 2 } },
      { text: "På vej mod ejerskifte", weights: { "generationsskifte-exit": 4, "jura-governance": 2 } },
    ],
  },
  {
    text: "Hvor vil I være om tre år?",
    type: "SINGLE",
    answers: [
      { text: "Dobbelt så store", weights: { "vaekst-salg": 4, "finansiering-kapital": 2, "ledelse-organisation": 2 } },
      { text: "Aktive på nye markeder", weights: { internationalisering: 5, "marketing-brand": 2, "vaekst-salg": 2 } },
      { text: "Solgt eller overdraget", weights: { "generationsskifte-exit": 5, "jura-governance": 2 } },
      { text: "Mere effektive og lønsomme", weights: { oekonomistyring: 4, "digitalisering-it": 3, strategi: 2 } },
      { text: "Førende på bæredygtighed", weights: { "baeredygtighed-esg": 5, strategi: 2, "marketing-brand": 1 } },
    ],
  },
  {
    text: "Hvilke områder mangler I kompetencer på?",
    helpText: "Vælg gerne flere.",
    type: "MULTI",
    answers: [
      { text: "Økonomi og finansiering", weights: { "finansiering-kapital": 3, oekonomistyring: 3 } },
      { text: "Salg og marketing", weights: { "vaekst-salg": 3, "marketing-brand": 3 } },
      { text: "Ledelse og HR", weights: { "ledelse-organisation": 3, "hr-rekruttering": 3 } },
      { text: "Teknologi og digitalisering", weights: { "digitalisering-it": 4 } },
      { text: "Jura og governance", weights: { "jura-governance": 4 } },
      { text: "Bæredygtighed og ESG", weights: { "baeredygtighed-esg": 4 } },
      { text: "Eksport og internationalisering", weights: { internationalisering: 4 } },
    ],
  },
  {
    text: "Hvor stor er virksomheden?",
    type: "SINGLE",
    answers: [
      { text: "1-9 medarbejdere", weights: { "vaekst-salg": 1, "finansiering-kapital": 1 } },
      { text: "10-49 medarbejdere", weights: { "ledelse-organisation": 2, "hr-rekruttering": 2, oekonomistyring: 1 } },
      { text: "50-199 medarbejdere", weights: { "ledelse-organisation": 3, "hr-rekruttering": 2, strategi: 2, "jura-governance": 1 } },
      { text: "200 eller flere medarbejdere", weights: { strategi: 3, "jura-governance": 2, "ledelse-organisation": 2 } },
    ],
  },
  {
    text: "Hvor bredt et board ønsker I?",
    helpText: "Flere rådgivere giver bredere kompetencer, men koster mere pr. møde.",
    type: "SINGLE",
    answers: [
      { text: "Et fokuseret board på to rådgivere", boardSize: 2, weights: {} },
      { text: "Et bredt board på tre rådgivere", boardSize: 3, weights: {} },
      { text: "Et fuldt board på fire rådgivere", boardSize: 4, weights: {} },
    ],
  },
];

/** Demokundens board (de første tre rådgivere). */
export const DEMO_BOARD_EMAILS = ["mette.lindberg@abu.local", "jesper.andersen@abu.local", "camilla.nielsen@abu.local"];
