import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";

function mockChain(result: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "insert", "update", "eq", "is", "maybeSingle", "single"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  (chain as { then: unknown }).then = (r: (x: unknown) => void) => r(result);
  return chain;
}
let supabaseMock: { from: ReturnType<typeof vi.fn> };
vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get: (_, p) =>
        p === "from"
          ? (...a: unknown[]) => (supabaseMock.from as (...x: unknown[]) => unknown)(...a)
          : undefined,
    },
  ),
}));
vi.mock("../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "u1");
      await next();
    },
  ),
}));
vi.mock("../../services/detectSourceType.js", () => ({ detectSourceType: vi.fn() }));
vi.mock("../../services/extractors/web.js", () => ({ extractWebClip: vi.fn() }));
vi.mock("../../services/extractors/tweet.js", () => ({ extractTweetClip: vi.fn() }));
vi.mock("../../lib/storage.js", () => ({
  signImageUrl: vi.fn(async () => "https://signed.example/a.jpg"),
}));
vi.mock("../../services/processImage.js", () => ({
  runImageVision: vi.fn(async () => ({
    kind: "text",
    content: "ocr'd text",
    excerpt: "ocr'd text",
    metadata: { kind: "text", storagePath: "u1/a.jpg" },
  })),
}));
vi.mock("../../services/enrich.js", () => ({
  enrichClip: vi.fn(async () => ({ summary: "s", tags: ["t"], category: "idea" })),
}));

const { clipsRoutes } = await import("../clips.js");

describe("POST /clips image branch", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Clips API");
    vi.clearAllMocks();
  });

  it("runs vision synchronously and saves an enriched image clip", async () => {
    supabaseMock = {
      from: vi
        .fn()
        .mockReturnValueOnce(mockChain({ data: [] })) // existing-tags query
        .mockReturnValueOnce(
          mockChain({
            data: {
              id: "c1",
              source_type: "image",
              hero_image_url: "u1/a.jpg",
              content: "ocr'd text",
              category: "idea",
              status: "completed",
              tags: ["t"],
              created_at: "t",
              updated_at: "t",
            },
            error: null,
          }),
        ), // insert
    };
    const app = new Hono();
    app.route("/clips", clipsRoutes);
    const res = await app.request("/clips", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imagePath: "u1/a.jpg" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.clip.sourceType).toBe("image");
    expect(json.clip.heroImageUrl).toBe("https://signed.example/a.jpg");
    expect(json.clip.category).toBe("idea");
  });
});
