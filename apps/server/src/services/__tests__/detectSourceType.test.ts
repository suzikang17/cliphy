import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { detectSourceType } from "../detectSourceType.js";

describe("detectSourceType", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Source Detection");
  });

  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
    ["https://twitter.com/jack/status/20", "tweet"],
    ["https://x.com/jack/status/20", "tweet"],
    ["https://x.com/jack/status/20?s=46", "tweet"],
    ["https://example.com/some-article", "web"],
    ["https://x.com/jack", "web"],
    ["not a url", "web"],
  ])("classifies %s as %s", (url, expected) => {
    expect(detectSourceType(url)).toBe(expected);
  });
});
