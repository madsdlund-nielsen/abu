/** Serialiserbare typer til admin-CMS'et (delt mellem server og klient). */
export interface CmsTag {
  id: string;
  slug: string;
  name: string;
  description: string;
  active: boolean;
  /** COMPETENCE: kompetence (matching, kunder ser det). ADMIN: internt tag, kun for admin. */
  kind: "COMPETENCE" | "ADMIN";
  /** Systemtag (fx «Lead-kvalificeret»): kan ikke deaktiveres */
  system: boolean;
  /** Aktive rådgivere med tagget */
  advisors: number;
  /** Svar der giver tagget en vægt */
  answers: number;
}

export interface CmsAnswer {
  id: string;
  text: string;
  boardSize: number | null;
  weights: { tagId: string; weight: number }[];
}

export interface CmsQuestion {
  id: string;
  text: string;
  helpText: string;
  type: "SINGLE" | "MULTI";
  active: boolean;
  answers: CmsAnswer[];
}

export interface CmsAdvisor {
  id: string;
  name: string;
  priceDkk: number;
  /** Kun kompetence-tags */
  tagIds: string[];
  /** Kan være ansvarlig rådgiver (internt lead-tag) */
  leadEligible?: boolean;
}

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
