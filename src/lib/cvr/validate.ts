const WEIGHTS = [2, 7, 6, 5, 4, 3, 2, 1];

/** Fjerner mellemrum og et evt. "DK"-præfiks. */
export function normalizeCvr(input: string): string {
  return input.replace(/\s+/g, "").replace(/^DK-?/i, "");
}

/** 8 cifre og modulus-11-kontrol (vægte 2-7-6-5-4-3-2-1, sum skal være deleligt med 11). */
export function isValidCvr(input: string): boolean {
  const cvr = normalizeCvr(input);
  if (!/^\d{8}$/.test(cvr)) return false;
  const sum = [...cvr].reduce((acc, ch, i) => acc + Number(ch) * WEIGHTS[i], 0);
  return sum % 11 === 0;
}
