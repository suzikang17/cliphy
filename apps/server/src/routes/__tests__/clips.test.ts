import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature, story } from "allure-js-commons";
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
      get: (_, p) =>
        p === "from"
          ? (...a: unknown[]) => (supabaseMock.from as (...args: unknown[]) => unknown)(...a)
          : undefined,
    },
  ),
}));
vi.mock("../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "test-user-id");
      await next();
    },
  ),
}));
vi.mock("../../services/detectSourceType.js", () => ({ detectSourceType: vi.fn(() => "web") }));
vi.mock("../../services/extractors/web.js", () => ({
  extractWebClip: vi.fn(async () => ({
    kind: "article",
    title: "T",
    siteName: "S",
    heroImageUrl: "h",
    excerpt: "e",
    content: "body",
    readingTimeMin: 2,
  })),
}));
vi.mock("../../services/extractors/tweet.js", () => ({ extractTweetClip: vi.fn() }));
vi.mock("../../services/enrich.js", () => ({
  enrichClip: vi.fn(async () => ({ summary: "s", tags: ["t"], category: "reading" })),
}));

const enqueueVideoMock = vi.fn();
vi.mock("../../services/enqueue-video.js", () => ({
  enqueueVideo: (...a: unknown[]) => enqueueVideoMock(...a),
}));

const { clipsRoutes } = await import("../clips.js");
const { detectSourceType } = await import("../../services/detectSourceType.js");
const { inngest } = await import("../../lib/inngest.js");

function app() {
  const a = new Hono();
  a.route("/clips", clipsRoutes);
  return a;
}

describe("POST /clips universal ingest", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Clips API");
    story("Universal POST");
    vi.clearAllMocks();
  });

  it("extracts a web url, saves the clip, and fires enrichment", async () => {
    supabaseMock = {
      from: vi
        .fn()
        .mockReturnValueOnce(mockChain({ data: null })) // dedup: none
        .mockReturnValueOnce(mockChain({ data: [] })) // existing-tags query (sync enrichment)
        .mockReturnValueOnce(
          mockChain({
            data: {
              id: "c1",
              source_type: "web",
              status: "completed",
              tags: [],
              created_at: "t",
              updated_at: "t",
            },
            error: null,
          }),
        ), // insert
    };
    const res = await app().request("/clips", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/post" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.clip.id).toBe("c1");
    expect(inngest.send).toHaveBeenCalledWith({
      name: "clip/embed.requested",
      data: { clipId: "c1" },
    });
  });

  it("routes a YouTube url to the summarize queue instead of saving a bare link", async () => {
    // Regression: iOS share → POST /clips saved YouTube as a completed bare link, never summarized.
    vi.mocked(detectSourceType).mockReturnValueOnce("youtube");
    supabaseMock = { from: vi.fn() };
    enqueueVideoMock.mockResolvedValue({
      ok: true,
      row: {
        id: "v1",
        source_type: "youtube",
        youtube_video_id: "GLvFTMtw4Jk",
        status: "pending",
        tags: [],
        created_at: "t",
        updated_at: "t",
      },
      position: 1,
    });
    const url = "https://youtube.com/watch?v=GLvFTMtw4Jk&is=6XeRZ5XN7SdinQto";

    const res = await app().request("/clips", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.clip).toMatchObject({ id: "v1", status: "pending", videoId: "GLvFTMtw4Jk" });
    expect(enqueueVideoMock).toHaveBeenCalledWith({ userId: "test-user-id", videoUrl: url });
    expect(supabaseMock.from).not.toHaveBeenCalled(); // no bare-link insert
  });

  it("passes queue errors (e.g. monthly limit) through for YouTube urls", async () => {
    vi.mocked(detectSourceType).mockReturnValueOnce("youtube");
    supabaseMock = { from: vi.fn() };
    enqueueVideoMock.mockResolvedValue({
      ok: false,
      status: 429,
      body: { error: "Monthly summary limit reached", code: "RATE_LIMITED" },
    });

    const res = await app().request("/clips", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://youtu.be/GLvFTMtw4Jk" }),
    });

    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("RATE_LIMITED");
  });

  it("rejects a missing url", async () => {
    supabaseMock = { from: vi.fn() };
    const res = await app().request("/clips", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
