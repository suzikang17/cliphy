import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

vi.mock("../../lib/supabase.js", () => ({ supabase: {} }));
vi.mock("../../lib/inngest.js", () => ({
  inngest: { createFunction: (_cfg: unknown, fn: unknown) => fn },
}));
vi.mock("../../services/embedding.js", () => ({ generateEmbedding: vi.fn() }));
vi.mock("../../services/enrich.js", () => ({ enrichClip: vi.fn() }));

const { buildEmbedText } = await import("../embed-clip.js");

describe("buildEmbedText", () => {
  beforeEach(() => {
    layer("unit");
    epic("Enrichment");
    feature("Embed Text");
  });

  it("uses author + content for tweets", () => {
    expect(
      buildEmbedText({ source_type: "tweet", author: "jack", content: "hi", summary_json: null }),
    ).toBe("jack: hi");
  });

  it("uses summary + key points otherwise", () => {
    expect(
      buildEmbedText({
        source_type: "youtube",
        author: null,
        content: null,
        summary_json: { summary: "S", keyPoints: ["a", "b"], timestamps: [] } as never,
      }),
    ).toBe("S a b");
  });

  it("embeds a note's own text, since it has no summary", () => {
    expect(
      buildEmbedText({
        source_type: "note",
        author: null,
        content: "shipped the pins tab\nfixed tailwind scanning",
        summary_json: null,
        video_title: "Daily note · 2026-09-07",
      }),
    ).toBe("shipped the pins tab\nfixed tailwind scanning");
  });

  it("falls back to the title for bookmark-tier clips with no summary", () => {
    // Metadata-tier bookmarks never get a Claude pass, so summary_json is null.
    // Without a fallback this embeds the empty string and the bookmark becomes
    // unfindable by semantic search — which is the whole reason we embed it.
    expect(
      buildEmbedText({
        source_type: "web",
        author: null,
        content: null,
        summary_json: null,
        video_title: "Linear",
        enrichment_tier: "metadata",
      }),
    ).toBe("Linear");
  });

  it("never returns an empty string when a title is present", () => {
    expect(
      buildEmbedText({
        source_type: "web",
        author: null,
        content: null,
        summary_json: null,
        video_title: "Some Bookmarked Site",
      }),
    ).not.toBe("");
  });
});
