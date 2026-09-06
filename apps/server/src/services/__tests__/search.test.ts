import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock("../../lib/supabase.js", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a), from: (...a: unknown[]) => fromMock(...a) },
}));
vi.mock("../embedding.js", () => ({ generateEmbedding: vi.fn(async () => [0.1, 0.2]) }));
vi.mock("../../lib/storage.js", () => ({ resolveClipImage: async (x: unknown) => x }));

const { semanticSearch } = await import("../search.js");

describe("semanticSearch", () => {
  beforeEach(() => {
    layer("unit");
    epic("Search");
    feature("Semantic");
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it("embeds the query, ranks via match_clips, maps rows", async () => {
    rpcMock.mockResolvedValue({ data: [{ id: "c2", similarity: 0.8 }], error: null });
    fromMock.mockReturnValue({
      select: () => ({
        in: () => ({
          data: [{ id: "c2", source_type: "web", status: "completed", tags: [] }],
          error: null,
        }),
      }),
    });
    const out = await semanticSearch("u1", "hello", 10);
    expect(out[0].id).toBe("c2");
  });
});
