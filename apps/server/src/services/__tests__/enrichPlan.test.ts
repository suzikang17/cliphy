import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { enrichPlan } from "../enrich.js";

// Which saved things get a summary, a category and tags, and when.

const clip = (over: Record<string, unknown>) => ({
  source_type: "web",
  enrichment_tier: "full",
  summary_json: null,
  content: "some words",
  ...over,
});

describe("enrichPlan", () => {
  beforeEach(async () => {
    await layer("unit");
    await epic("Library");
    await feature("Auto-tagging");
  });

  it("fills in web pages, tweets and images once, as before", () => {
    for (const source_type of ["web", "tweet", "image"]) {
      expect(enrichPlan(clip({ source_type }))).toBe("fill");
      expect(enrichPlan(clip({ source_type, summary_json: { summary: "x" } }))).toBe("skip");
    }
  });

  it("never spends a model call on a bookmark-only save", () => {
    expect(enrichPlan(clip({ enrichment_tier: "metadata" }))).toBe("skip");
  });

  it("tags a voice note once it has words, and only once", () => {
    expect(enrichPlan(clip({ source_type: "voice" }))).toBe("fill");
    expect(enrichPlan(clip({ source_type: "voice", content: "" }))).toBe("skip");
    expect(enrichPlan(clip({ source_type: "voice", summary_json: { summary: "x" } }))).toBe("skip");
  });

  it("tags a note every time it changes, whatever tier it was saved at", () => {
    expect(enrichPlan(clip({ source_type: "note", enrichment_tier: "metadata" }))).toBe("refresh");
    expect(
      enrichPlan(
        clip({ source_type: "note", enrichment_tier: "metadata", summary_json: { summary: "x" } }),
      ),
    ).toBe("refresh");
    expect(enrichPlan(clip({ source_type: "note", content: "   " }))).toBe("skip");
  });

  it("leaves videos and podcasts to their own pipeline", () => {
    expect(enrichPlan(clip({ source_type: "youtube" }))).toBe("skip");
    expect(enrichPlan(clip({ source_type: "podcast" }))).toBe("skip");
  });
});
