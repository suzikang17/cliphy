import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

// vi.mock calls are hoisted — must appear before imports of the module under test
vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: vi.fn() },
}));
vi.mock("../../services/embedding.js", () => ({
  generateEmbedding: vi.fn(),
}));

import { buildEmbedText } from "../embed-clip.js";

describe("buildEmbedText", () => {
  beforeEach(() => {
    layer("unit");
    epic("Embedding");
    feature("embed-clip");
  });

  it("builds tweet embed text as '@handle: content'", () => {
    const text = buildEmbedText({
      source_type: "tweet",
      author: "@alice",
      content: "Hello world",
      summary_json: null,
    });
    expect(text).toBe("@alice: Hello world");
  });

  it("builds YouTube embed text from summary and keyPoints", () => {
    const text = buildEmbedText({
      source_type: "youtube",
      author: "Channel",
      content: null,
      summary_json: {
        summary: "Great video about cats",
        keyPoints: ["cats are fluffy", "cats sleep a lot"],
        timestamps: [],
      },
    });
    expect(text).toBe("Great video about cats cats are fluffy cats sleep a lot");
  });
});
