import { describe, expect, it } from "vitest";
import type { CmsAdvisor, CmsQuestion, CmsTag } from "./cms-types";
import { collectWarnings } from "./warnings";

const tag = (id: string, active = true): CmsTag => ({ id, slug: id, name: id.toUpperCase(), description: "", active, kind: "COMPETENCE", system: false, advisors: 0, answers: 0 });
const q = (id: string, answers: CmsQuestion["answers"], active = true): CmsQuestion => ({ id, text: id, helpText: "", type: "SINGLE", active, answers });
const ans = (id: string, tagIds: string[], boardSize: number | null = null) => ({ id, text: id, boardSize, weights: tagIds.map((tagId) => ({ tagId, weight: 3 })) });
const adv = (tagIds: string[]): CmsAdvisor => ({ id: "a", name: "A", priceDkk: 1750, tagIds });

describe("collectWarnings", () => {
  it("advarer om aktivt spørgsmål med under 2 svar, men ikke om inaktive", () => {
    const w = collectWarnings([q("q1", [ans("a1", ["t"])]), q("q2", [], false)], [tag("t")], [adv(["t"])]);
    expect(w.filter((x) => x.scope === "question").map((x) => x.id)).toEqual(["q1"]);
  });
  it("advarer om svar uden vægte, men ikke hvis svaret sætter board-størrelse", () => {
    const w = collectWarnings([q("q", [ans("a1", []), ans("a2", [], 3), ans("a3", ["t"])])], [tag("t")], [adv(["t"])]);
    expect(w.filter((x) => x.scope === "answer").map((x) => x.id)).toEqual(["a1"]);
  });
  it("advarer om tags uden rådgivere én gang og om deaktiverede tags", () => {
    const w = collectWarnings(
      [q("q", [ans("a1", ["x", "y"]), ans("a2", ["x"])])],
      [tag("x"), tag("y", false)],
      [adv(["z"])],
    );
    expect(w.filter((x) => x.scope === "tag").map((x) => x.id).sort()).toEqual(["x", "y"]);
  });
  it("giver ingen advarsler for et sundt setup", () => {
    expect(collectWarnings([q("q", [ans("a1", ["t"]), ans("a2", ["t"])])], [tag("t")], [adv(["t"])])).toEqual([]);
  });
});
