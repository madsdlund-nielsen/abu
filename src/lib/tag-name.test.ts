import { describe, expect, it } from "vitest";
import { isDuplicateTagName, normalizeTagName } from "./tag-name";

describe("tag-navne", () => {
  it("normaliserer store/små bogstaver og mellemrum", () => {
    expect(normalizeTagName("  Vækst   &  Salg ")).toBe("vækst & salg");
  });
  it("finder dubletter uanset versaler", () => {
    expect(isDuplicateTagName(["Strategi", "Jura & governance"], "strategi ")).toBe(true);
    expect(isDuplicateTagName(["Strategi"], "Strategisk ledelse")).toBe(false);
  });
});
