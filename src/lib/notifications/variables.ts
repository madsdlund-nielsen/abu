import { formatInTimeZone } from "date-fns-tz";
import { da } from "date-fns/locale";
import { formatDateShort, formatTime, TZ } from "../time";

/** "A", "A og B", "A, B og C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} og ${names[names.length - 1]}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** mødedato ("torsdag 12. november 2026"), mødedato_kort ("tor. 12. nov.") og mødetid ("10:00"). */
export function meetingDateVars(startsAt: Date): Record<"mødedato" | "mødedato_kort" | "mødetid", string> {
  return {
    mødedato: formatInTimeZone(startsAt, TZ, "EEEE d. MMMM yyyy", { locale: da }),
    mødedato_kort: formatDateShort(startsAt),
    mødetid: formatTime(startsAt),
  };
}

export type ChangeRole = "customer" | "added" | "removed";

/**
 * Beskrivelse af en ændring, tilpasset modtageren: kunden hører hvem der er skiftet, den tilføjede rådgiver at vedkommende
 * er kommet til, og den fjernede at vedkommende er udgået.
 */
export function describeChange(opts: {
  scope: "meeting" | "board";
  role: ChangeRole;
  added: string[];
  removed: string[];
  /** Board: antal kommende møder, der er opdateret med ændringen */
  upcomingUpdated?: number;
}): string {
  const { scope, role, added, removed } = opts;
  const where = scope === "meeting" ? "mødet" : "boardet";
  let text: string;
  if (role === "added") {
    text = `Du er tilføjet som rådgiver ${scope === "meeting" ? "til mødet" : "på boardet"}${removed.length ? `, i stedet for ${joinNames(removed)}` : ""}.`;
  } else if (role === "removed") {
    text = `Du er udgået af ${where}${added.length ? `, og ${joinNames(added)} deltager i stedet` : ""}.`;
  } else if (added.length && removed.length) {
    text = `${joinNames(removed)} er udgået af ${where}, og ${joinNames(added)} deltager i stedet.`;
  } else if (added.length) {
    text = `${joinNames(added)} er tilføjet ${scope === "meeting" ? "som deltager" : "til boardet"}.`;
  } else if (removed.length) {
    text = `${joinNames(removed)} er udgået af ${where}.`;
  } else {
    text = `Der er sket en ændring af ${where}.`;
  }
  if (scope === "board" && role === "customer" && opts.upcomingUpdated) {
    text += ` ${opts.upcomingUpdated === 1 ? "1 kommende møde er" : `${opts.upcomingUpdated} kommende møder er`} opdateret med de nye rådgivere.`;
  }
  return text;
}
