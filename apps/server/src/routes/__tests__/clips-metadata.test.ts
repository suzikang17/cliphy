import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";

function mockChain(result: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "from",
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "neq",
    "in",
    "is",
    "or",
    "order",
    "range",
    "limit",
    "single",
    "maybeSingle",
  ];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  (chain as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(result);
  return chain;
}

let supabaseMock: { from: ReturnType<typeof vi.fn> };
vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get: (_: unknown, p: string) =>
        p === "from"
          ? (...a: unknown[]) => (supabaseMock.from as (...args: unknown[]) => unknown)(...a)
          : undefined,
    },
  ),
}));
const inngestSend = vi.fn();
vi.mock("../../lib/inngest.js", () => ({
  inngest: { send: (...a: unknown[]) => inngestSend(...a) },
}));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "test-user-id");
      await next();
    },
  ),
}));
vi.mock("../../services/detectSourceType.js", () => ({ detectSourceType: vi.fn(() => "web") }));
const extractWebMetadata = vi.fn(async () => ({
  title: "Linear",
  siteName: "Linear",
  faviconUrl: "https://linear.app/favicon.ico",
  heroImageUrl: "https://linear.app/og.png",
}));
vi.mock("../../services/extractors/webMetadata.js", () => ({
  extractWebMetadata: (...a: unknown[]) => extractWebMetadata(...(a as [])),
}));
vi.mock("../../services/extractors/web.js", () => ({ extractWebClip: vi.fn() }));
vi.mock("../../services/extractors/tweet.js", () => ({ extractTweetClip: vi.fn() }));
vi.mock("../../services/enrich.js", () => ({ enrichClip: vi.fn() }));
vi.mock("../../lib/storage.js", () => ({
  signImageUrl: vi.fn(async () => null),
  resolveClipImage: vi.fn(async (c: unknown) => c),
}));
vi.mock("../../services/related.js", () => ({ findRelatedClips: vi.fn(async () => []) }));

const { clipsRoutes } = await import("../clips.js");

function app() {
  return new Hono().route("/api/clips", clipsRoutes);
}

function addBookmark(url: string) {
  return app().request("/api/clips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, tier: "metadata" }),
  });
}

const savedRow = {
  id: "c1",
  source_type: "web",
  enrichment_tier: "metadata",
  created_at: "t",
  updated_at: "t",
  status: "completed",
  tags: [],
};

describe("metadata-tier capture", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Bookmarks");
    vi.clearAllMocks();
    extractWebMetadata.mockResolvedValue({
      title: "Linear",
      siteName: "Linear",
      faviconUrl: "https://linear.app/favicon.ico",
      heroImageUrl: "https://linear.app/og.png",
    });
  });

  it("saves a metadata clip without running the article extractor", async () => {
    const chain = mockChain({ data: savedRow, error: null });
    supabaseMock = {
      from: vi
        .fn()
        .mockReturnValueOnce(mockChain({ data: null })) // dedup: no existing clip
        .mockReturnValue(chain), // insert
    };

    const res = await addBookmark("https://linear.app");

    expect(res.status).toBe(201);
    expect(extractWebMetadata).toHaveBeenCalledWith("https://linear.app");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ enrichment_tier: "metadata", video_title: "Linear" }),
    );
  });

  it("still requests an embedding for a metadata clip", async () => {
    const chain = mockChain({ data: savedRow, error: null });
    supabaseMock = {
      from: vi
        .fn()
        .mockReturnValueOnce(mockChain({ data: null }))
        .mockReturnValue(chain),
    };

    await addBookmark("https://linear.app");

    // Without this, bookmarks are invisible to semantic search.
    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({ name: "clip/embed.requested" }),
    );
  });

  it("saves the clip with the url as title when metadata extraction fails", async () => {
    extractWebMetadata.mockRejectedValueOnce(new Error("unreachable"));
    const chain = mockChain({ data: savedRow, error: null });
    supabaseMock = {
      from: vi
        .fn()
        .mockReturnValueOnce(mockChain({ data: null }))
        .mockReturnValue(chain),
    };

    const res = await addBookmark("https://linear.app");

    expect(res.status).toBe(201);
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ video_title: "https://linear.app" }),
    );
  });
});
