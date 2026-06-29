import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

describe("generateEmbedding", () => {
  beforeEach(() => {
    layer("unit");
    epic("Embedding");
    feature("Voyage AI");
    process.env.VOYAGE_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 1024-dim array from Voyage AI", async () => {
    const mockEmbedding = Array.from({ length: 1024 }, (_, i) => i * 0.001);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: mockEmbedding }] }),
    } as unknown as Response);

    const { generateEmbedding } = await import("../embedding.js");
    const result = await generateEmbedding("hello world");

    expect(result).toHaveLength(1024);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.voyageai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ input: "hello world", model: "voyage-3" }),
      }),
    );
  });

  it("throws on non-OK response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    } as unknown as Response);

    const { generateEmbedding } = await import("../embedding.js");
    await expect(generateEmbedding("test")).rejects.toThrow("Voyage AI embedding failed: 401");
  });
});
