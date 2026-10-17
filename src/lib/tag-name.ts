/** Normaliseret tag-navn til dublet-tjek (store/små bogstaver og ekstra mellemrum er ligegyldige). */
export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("da");
}

export function isDuplicateTagName(existing: string[], name: string): boolean {
  const n = normalizeTagName(name);
  return existing.some((e) => normalizeTagName(e) === n);
}
