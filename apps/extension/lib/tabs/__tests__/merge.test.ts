import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { combineMeta, dropZone, resolveAlias } from "../merge";

describe("merging groups", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — merge");
  });

  describe("dropZone", () => {
    // A 40px-tall header at y=100.
    it.each([
      [100, "before"],
      [109, "before"],
      [110, "merge"],
      [120, "merge"],
      [130, "merge"],
      [131, "after"],
      [140, "after"],
    ])("y=%i → %s", (y, zone) => {
      expect(dropZone(y, 100, 40, true)).toBe(zone);
    });

    it("only reorders when merging isn't allowed (e.g. Probably done)", () => {
      expect(dropZone(120, 100, 40, false)).toBe("after");
      expect(dropZone(115, 100, 40, false)).toBe("before");
    });
  });

  describe("combineMeta", () => {
    it("keeps the target's first, appends the source's, dedupes spacing variants", () => {
      expect(
        combineMeta(
          { hints: "interior studio work", keywords: ["we curate life", "olive ateliers"] },
          { hints: "AI tools", keywords: ["wecuratelife", "typesafe"] },
        ),
      ).toEqual({
        hints: "interior studio work; AI tools",
        keywords: ["we curate life", "olive ateliers", "typesafe"],
      });
    });

    it("handles empty sides and caps keywords at 10", () => {
      const many = Array.from({ length: 8 }, (_, i) => `kw${i}xx`);
      const r = combineMeta(
        { hints: "", keywords: many },
        { hints: "", keywords: ["aaaa", "bbbb", "cccc"] },
      );
      expect(r.hints).toBe("");
      expect(r.keywords).toHaveLength(10);
    });
  });

  describe("resolveAlias", () => {
    it("follows chains and stops on cycles", () => {
      expect(resolveAlias("ai", { ai: "design", design: "studio" })).toBe("studio");
      expect(resolveAlias("x", { x: "y", y: "x" })).toBe("y");
      expect(resolveAlias("design", {})).toBe("design");
    });
  });
});
