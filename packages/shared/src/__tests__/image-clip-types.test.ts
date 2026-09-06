import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { SOURCE_TYPES } from "../constants";

describe("image source type", () => {
  beforeEach(() => {
    layer("unit");
    epic("Data");
    feature("Image Clip Types");
  });

  it("SOURCE_TYPES exposes image", () => {
    expect(SOURCE_TYPES.IMAGE).toBe("image");
  });
});
