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
});
