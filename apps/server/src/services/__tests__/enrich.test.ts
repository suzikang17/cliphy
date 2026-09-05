import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { parseEnrichment } from "../enrich.js";

describe("enrichment parsing", () => {
  beforeEach(() => {
    layer("unit");
    epic("Enrichment");
    feature("Parse");
  });

  it("parses a well-formed JSON block", () => {
    const raw =
      '```json\n{"summary":"A note on brand systems.","tags":["design","branding"],"category":"design"}\n```';
    const out = parseEnrichment(raw);
    expect(out.summary).toBe("A note on brand systems.");
    expect(out.tags).toEqual(["design", "branding"]);
    expect(out.category).toBe("design");
  });

  it("falls back to reference category on an invalid category value", () => {
    const raw = '{"summary":"x","tags":[],"category":"nonsense"}';
    expect(parseEnrichment(raw).category).toBe("reference");
  });
});
