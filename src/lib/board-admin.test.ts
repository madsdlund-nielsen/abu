import { describe, expect, it } from "vitest";
import { diffBoard, pairReplacements } from "./board-admin";

describe("diffBoard", () => {
  it("finder tilføjede, fjernede og beholdte", () => {
    expect(diffBoard(["a", "b", "c"], ["a", "d", "e"])).toEqual({ added: ["d", "e"], removed: ["b", "c"], kept: ["a"] });
    expect(diffBoard(["a", "b"], ["a", "b"])).toEqual({ added: [], removed: [], kept: ["a", "b"] });
  });
});

describe("pairReplacements", () => {
  it("parrer udskiftninger og efterlader ekstra", () => {
    expect(pairReplacements(["x"], ["y"])).toEqual({ pairs: [{ out: "x", in: "y" }], extraRemoved: [], extraAdded: [] });
    expect(pairReplacements(["x", "z"], ["y"])).toEqual({ pairs: [{ out: "x", in: "y" }], extraRemoved: ["z"], extraAdded: [] });
    expect(pairReplacements([], ["y", "w"])).toEqual({ pairs: [], extraRemoved: [], extraAdded: ["y", "w"] });
  });
});
