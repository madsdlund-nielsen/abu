/* Ingen afhængigheder: importeres også af klientkomponenter (CMS), så env/zod ikke havner i browseren. */

/** 3-11 tegn: bogstaver og tal uden æøå/mellemrum (GSM-afsender), eller et internationalt nummer. */
export function validateSmsSender(value: string): string | null {
  const v = value.trim();
  if (/^\+?\d{6,15}$/.test(v)) return null;
  if (v.length < 3) return "Afsendernavnet skal være mindst 3 tegn.";
  if (v.length > 11) return "Afsendernavnet må højst være 11 tegn.";
  if (!/^[A-Za-z0-9]+$/.test(v)) return "Brug kun bogstaver (a-z) og tal, uden mellemrum, æ, ø og å.";
  return null;
}
