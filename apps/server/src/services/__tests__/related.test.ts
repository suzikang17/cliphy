import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock("../../lib/supabase.js", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a), from: (...a: unknown[]) => fromMock(...a) },
}));
vi.mock("../../lib/storage.js", () => ({ resolveClipImage: async (x: unknown) => x }));

const { findRelatedClips } = await import("../related.js");

describe("findRelatedClips", () => {
  beforeEach(() => {
    layer("unit");
    epic("Search");
    feature("Related");
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it("returns [] when the source clip has no embedding", async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({ single: () => ({ data: { embedding: null }, error: null }) }),
      }),
    });
    expect(await findRelatedClips("c1", "u1")).toEqual([]);
  });

  it("maps matched rows to clips", async () => {
    fromMock
      .mockReturnValueOnce({
        select: () => ({
          eq: () => ({ single: () => ({ data: { embedding: [0.1, 0.2] }, error: null }) }),
        }),
      })
      .mockReturnValueOnce({
        select: () => ({
          in: () => ({
            data: [{ id: "c2", source_type: "web", status: "completed", tags: [] }],
            error: null,
          }),
        }),
      });
    rpcMock.mockResolvedValue({ data: [{ id: "c2", similarity: 0.9 }], error: null });
    const out = await findRelatedClips("c1", "u1");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("c2");
  });
});
