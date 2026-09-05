import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { SOURCE_TYPES, CLIP_CATEGORIES } from "../constants";

describe("clip source types & categories", () => {
  beforeEach(() => {
    layer("unit");
    epic("Data");
    feature("Clip Types");
  });

  it("SOURCE_TYPES includes web alongside existing types", () => {
    expect(Object.values(SOURCE_TYPES)).toEqual(
      expect.arrayContaining(["youtube", "tweet", "podcast", "web"]),
    );
  });

  it("CLIP_CATEGORIES exposes the inbox buckets", () => {
    expect(Object.values(CLIP_CATEGORIES)).toEqual(
      expect.arrayContaining(["idea", "reading", "design", "reference"]),
    );
  });
});
