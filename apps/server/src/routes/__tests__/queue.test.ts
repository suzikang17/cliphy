import { describe, it, expect, vi, beforeEach } from "vitest";
import { epic, feature, story, layer, severity } from "allure-js-commons";
import { Hono } from "hono";
import type { AppEnv } from "../../env.js";
import { extractVideoId } from "@cliphy/shared";

// ── Mock Supabase ─────────────────────────────────────────────

// Chainable mock that resolves to a configurable result
function mockChain(result: { data?: unknown; error?: unknown; count?: number | null } = {}) {
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
    "lt",
    "gte",
    "or",
    "order",
    "range",
    "limit",
    "single",
    "maybeSingle",
    "rpc",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

let supabaseMock: ReturnType<typeof mockChain>;

vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "auth") return { getUser: vi.fn() };
        if (prop === "rpc")
          return (...args: unknown[]) =>
            (supabaseMock.rpc as (...a: unknown[]) => unknown)(...args);
        if (prop === "from")
          return (...args: unknown[]) =>
            (supabaseMock.from as (...a: unknown[]) => unknown)(...args);
        return undefined;
      },
    },
  ),
}));

vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "test-user-id");
      c.set("userEmail", "test@example.com");
      await next();
    },
  ),
}));

vi.mock("../../services/transcript.js", () => ({
  fetchTranscript: vi.fn().mockResolvedValue({ text: "fake transcript text", truncated: false }),
  TranscriptNotAvailableError: class extends Error {},
}));

vi.mock("../../services/summarizer.js", () => ({
  summarizeTranscript: vi.fn().mockResolvedValue({
    summary: "A summary",
    keyPoints: ["Point 1"],
    timestamps: ["0:00"],
  }),
}));

vi.mock("../../lib/inngest.js", () => ({
  inngest: {
    send: vi.fn().mockResolvedValue({ ids: [] }),
  },
}));

// Dynamically import to pick up mocks
async function createApp() {
  const { queueRoutes } = await import("../queue.js");
  const app = new Hono<AppEnv>().route("/queue", queueRoutes);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────

describe("Queue", () => {
  describe("extractVideoId", () => {
    beforeEach(() => {
      layer("unit");
      epic("Video Processing");
      feature("URL Parsing");
    });

    it("extracts from youtube.com/watch?v=", () => {
      expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts from youtu.be/", () => {
      expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts from youtube.com/embed/", () => {
      expect(extractVideoId("https://youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts from youtube.com/shorts/", () => {
      expect(extractVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts from youtube.com/v/", () => {
      expect(extractVideoId("https://youtube.com/v/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts from m.youtube.com", () => {
      expect(extractVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("returns null for non-YouTube URLs", () => {
      expect(extractVideoId("https://vimeo.com/123456")).toBeNull();
    });

    it("returns null for invalid URLs", () => {
      expect(extractVideoId("not a url")).toBeNull();
    });

    it("returns null for YouTube URL without video ID", () => {
      expect(extractVideoId("https://youtube.com/")).toBeNull();
    });

    it("handles extra query params", () => {
      expect(extractVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ&t=120")).toBe("dQw4w9WgXcQ");
    });
  });

  describe("POST /queue", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      layer("unit");
      epic("Queue");
      feature("Add Video");
      story("Single video");
    });

    // The save itself is one database function (migration 049, enqueue_video);
    // its rules are tested against real SQL in services/__tests__/enqueue-video.sql.test.ts.
    const row = {
      id: "sum-1",
      user_id: "test-user-id",
      youtube_video_id: "dQw4w9WgXcQ",
      video_title: null,
      video_url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
      status: "pending",
      created_at: "2026-11-23T10:00:00Z",
    };
    const answering = (result: Record<string, unknown>) => {
      supabaseMock = {
        from: vi.fn().mockImplementation(() => mockChain({})),
        rpc: vi.fn().mockReturnValue(mockChain(result)),
      } as unknown as ReturnType<typeof mockChain>;
    };
    const post = async (body: Record<string, unknown>) =>
      (await createApp()).request("/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const VIDEO = { videoUrl: "https://youtube.com/watch?v=dQw4w9WgXcQ" };

    it("adds a video in one database call and returns 201 with summary and position", async () => {
      severity("critical");
      answering({ data: { outcome: "ok", row, position: 3 } });
      const res = await post({ ...VIDEO, videoTitle: "Never Gonna" });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.summary.videoId).toBe("dQw4w9WgXcQ");
      expect(json.summary.status).toBe("pending");
      expect(json.position).toBe(3);

      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("enqueue_video", {
        p_user_id: "test-user-id",
        p_video_id: "dQw4w9WgXcQ",
        p_video_url: VIDEO.videoUrl,
        p_video_title: "Never Gonna",
        p_video_channel: null,
        p_duration_seconds: null,
        p_limits: { free: 5, pro: 100 },
        p_window_seconds: 60,
        p_want_position: true,
      });
      // Nothing else is read or written on the way.
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("fires the summarize event once, with an idempotent id", async () => {
      answering({ data: { outcome: "ok", row, position: 1 } });
      await post(VIDEO);
      const { inngest } = await import("../../lib/inngest.js");
      expect(inngest.send).toHaveBeenCalledTimes(1);
      expect(inngest.send).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "summarize-sum-1",
          name: "video/summarize.requested",
          data: expect.objectContaining({ summaryId: "sum-1", videoId: "dQw4w9WgXcQ" }),
        }),
      );
    });

    it("returns 400 for invalid YouTube URL", async () => {
      supabaseMock = mockChain({});
      const app = await createApp();
      const res = await app.request("/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: "https://vimeo.com/123" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid/i);
    });

    it("returns 400 when videoUrl is missing", async () => {
      supabaseMock = mockChain({});
      const app = await createApp();
      const res = await app.request("/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for video exceeding max duration", async () => {
      supabaseMock = mockChain({});
      const app = await createApp();
      const res = await app.request("/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: "https://youtube.com/watch?v=dQw4w9WgXcQ",
          videoDurationSeconds: 4 * 60 * 60 + 1, // 4 hours + 1 second
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("VIDEO_TOO_LONG");
    });

    it("returns 400 for negative video duration", async () => {
      supabaseMock = mockChain({});
      const app = await createApp();
      const res = await app.request("/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: "https://youtube.com/watch?v=dQw4w9WgXcQ",
          videoDurationSeconds: -1,
        }),
      });

      expect(res.status).toBe(400);
    });

    it("accepts zero duration as valid", async () => {
      answering({ data: { outcome: "ok", row, position: 1 } });
      const res = await post({ ...VIDEO, videoDurationSeconds: 0 });
      expect(res.status).toBe(201);
      expect(supabaseMock.rpc).toHaveBeenCalledWith(
        "enqueue_video",
        expect.objectContaining({ p_duration_seconds: 0 }),
      );
    });

    it("returns 409 for a video queued moments ago, and starts no summary", async () => {
      answering({ data: { outcome: "duplicate" } });
      const res = await post(VIDEO);
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("DUPLICATE");
      const { inngest } = await import("../../lib/inngest.js");
      expect(inngest.send).not.toHaveBeenCalled();
    });

    it("returns 429 with the limit and plan when the month is used up", async () => {
      answering({ data: { outcome: "limited", limit: 5, plan: "free" } });
      const res = await post(VIDEO);
      expect(res.status).toBe(429);
      expect(await res.json()).toMatchObject({ code: "RATE_LIMITED", limit: 5, plan: "free" });
    });

    it("returns 500 when the database call fails, and starts no summary", async () => {
      answering({ data: null, error: { message: "boom" } });
      const res = await post(VIDEO);
      expect(res.status).toBe(500);
      const { inngest } = await import("../../lib/inngest.js");
      expect(inngest.send).not.toHaveBeenCalled();
    });
  });

  describe("POST /queue/batch", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      layer("unit");
      epic("Queue");
      feature("Add Video");
      story("Batch");
    });

    it("returns 402 with upgrade URL for non-pro users", async () => {
      const userChain = mockChain({
        data: { plan: "free", monthly_summary_count: 0, monthly_count_reset_at: "2026-02-20" },
      });

      supabaseMock = {
        from: vi.fn().mockReturnValue(userChain),
        rpc: vi.fn(),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const res = await app.request("/queue/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videos: [{ videoUrl: "https://youtube.com/watch?v=dQw4w9WgXcQ" }],
        }),
      });

      expect(res.status).toBe(402);
      const json = await res.json();
      expect(json.code).toBe("pro_required");
      expect(json.feature).toBe("batch_queue");
      expect(json.upgrade_url).toBeDefined();
    });

    it("returns 400 for more than 10 videos", async () => {
      // requirePro middleware runs first and checks plan
      const proChain = mockChain({ data: { plan: "pro" } });
      supabaseMock = {
        from: vi.fn().mockReturnValue(proChain),
        rpc: vi.fn(),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const videos = Array.from({ length: 11 }, (_, i) => ({
        videoUrl: `https://youtube.com/watch?v=dQw4w9WgXc${String.fromCharCode(65 + i)}`,
      }));

      const res = await app.request("/queue/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videos }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/10/);
    });

    it("returns 400 for empty videos array", async () => {
      // requirePro middleware runs first and checks plan
      const proChain = mockChain({ data: { plan: "pro" } });
      supabaseMock = {
        from: vi.fn().mockReturnValue(proChain),
        rpc: vi.fn(),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const res = await app.request("/queue/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videos: [] }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /queue/:id", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      layer("unit");
      epic("Queue");
      feature("Remove Video");
    });

    it("deletes a queued item", async () => {
      const fetchChain = mockChain({
        data: { id: "sum-1", status: "pending", user_id: "test-user-id" },
      });
      const deleteChain = mockChain({ error: null });

      let callCount = 0;
      supabaseMock = {
        from: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return fetchChain;
          return deleteChain;
        }),
        rpc: vi.fn(),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const res = await app.request("/queue/sum-1", { method: "DELETE" });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.deleted).toBe(true);
    });

    it("returns 404 for non-existent item", async () => {
      supabaseMock = {
        from: vi.fn().mockReturnValue(mockChain({ data: null, error: { message: "not found" } })),
        rpc: vi.fn(),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const res = await app.request("/queue/nonexistent", { method: "DELETE" });

      expect(res.status).toBe(404);
    });

    it("returns 409 for processing items", async () => {
      supabaseMock = {
        from: vi
          .fn()
          .mockReturnValue(
            mockChain({ data: { id: "sum-1", status: "processing", user_id: "test-user-id" } }),
          ),
        rpc: vi.fn(),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const res = await app.request("/queue/sum-1", { method: "DELETE" });

      expect(res.status).toBe(409);
    });
  });

  describe("GET /queue", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      layer("unit");
      epic("Queue");
      feature("List Queue");
    });

    it("returns list of queue items", async () => {
      const rows = [
        {
          id: "sum-1",
          user_id: "test-user-id",
          youtube_video_id: "abc12345678",
          video_title: "Test Video",
          video_url: "https://youtube.com/watch?v=abc12345678",
          status: "pending",
          summary_json: null,
          error_message: null,
          created_at: "2026-02-20T10:00:00Z",
          updated_at: "2026-02-20T10:00:00Z",
        },
      ];

      supabaseMock = {
        from: vi.fn().mockReturnValue(mockChain({ data: rows })),
        rpc: vi.fn(),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const res = await app.request("/queue");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.items).toHaveLength(1);
      expect(json.items[0].videoId).toBe("abc12345678");
    });
  });

  describe("POST /queue/:id/retry", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      layer("unit");
      epic("Queue");
      feature("Process Video");
    });

    it("fires Inngest event for a pending queue item", async () => {
      severity("critical");
      const fetchChain = mockChain({
        data: {
          id: "sum-1",
          status: "pending",
          user_id: "test-user-id",
          youtube_video_id: "dQw4w9WgXcQ",
          video_title: null,
          video_url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
          summary_json: null,
          error_message: null,
          created_at: "2026-02-20T10:00:00Z",
          updated_at: "2026-02-20T10:00:00Z",
        },
      });
      const updateChain = mockChain({ data: { id: "sum-1" } });

      let callCount = 0;
      supabaseMock = {
        from: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return fetchChain;
          return updateChain;
        }),
        rpc: vi.fn(),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const res = await app.request("/queue/sum-1/retry", { method: "POST" });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.summary.status).toBe("pending");
    });

    it("returns 404 for non-existent item", async () => {
      supabaseMock = {
        from: vi.fn().mockReturnValue(mockChain({ data: null, error: { message: "not found" } })),
        rpc: vi.fn(),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const res = await app.request("/queue/nonexistent/retry", { method: "POST" });
      expect(res.status).toBe(404);
    });

    it("returns 409 for processing item", async () => {
      supabaseMock = {
        from: vi
          .fn()
          .mockReturnValue(
            mockChain({ data: { id: "sum-1", status: "processing", user_id: "test-user-id" } }),
          ),
        rpc: vi.fn(),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const res = await app.request("/queue/sum-1/retry", { method: "POST" });
      expect(res.status).toBe(409);
    });

    it("allows retry for completed item (re-summarize)", async () => {
      const fetchChain = mockChain({
        data: {
          id: "sum-1",
          status: "completed",
          user_id: "test-user-id",
          youtube_video_id: "dQw4w9WgXcQ",
          video_title: "Test Video",
          video_url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
          summary_json: { summary: "old" },
          error_message: null,
          created_at: "2026-02-20T10:00:00Z",
          updated_at: "2026-02-20T10:00:00Z",
        },
      });
      const planChain = mockChain({ data: { plan: "pro" } });
      const updateChain = mockChain({ data: { id: "sum-1" } });

      let callCount = 0;
      supabaseMock = {
        from: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return fetchChain;
          if (callCount === 2) return planChain;
          return updateChain;
        }),
        rpc: vi.fn(),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const res = await app.request("/queue/sum-1/retry", { method: "POST" });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.summary.status).toBe("pending");
      expect(json.summary.summaryJson).toBeUndefined();
    });

    it("checks rate limit when retrying a failed item", async () => {
      severity("critical");
      const fetchChain = mockChain({
        data: {
          id: "sum-1",
          status: "failed",
          user_id: "test-user-id",
          youtube_video_id: "dQw4w9WgXcQ",
          video_title: null,
          video_url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
          summary_json: null,
          error_message: "Previous error",
          created_at: "2026-02-20T10:00:00Z",
          updated_at: "2026-02-20T10:00:00Z",
        },
      });
      const planChain = mockChain({ data: { plan: "free" } });
      const rpcChain = mockChain({ data: false }); // rate limited

      let callCount = 0;
      supabaseMock = {
        from: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return fetchChain;
          if (callCount === 2) return planChain;
          return mockChain({});
        }),
        rpc: vi.fn().mockReturnValue(rpcChain),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const res = await app.request("/queue/sum-1/retry", { method: "POST" });

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.code).toBe("RATE_LIMITED");
    });

    it("skips rate limit check when retrying a pending item", async () => {
      const fetchChain = mockChain({
        data: {
          id: "sum-1",
          status: "pending",
          user_id: "test-user-id",
          youtube_video_id: "dQw4w9WgXcQ",
          video_title: null,
          video_url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
          summary_json: null,
          error_message: null,
          created_at: "2026-02-20T10:00:00Z",
          updated_at: "2026-02-20T10:00:00Z",
        },
      });
      const updateChain = mockChain({ data: { id: "sum-1" } });

      let callCount = 0;
      supabaseMock = {
        from: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return fetchChain;
          return updateChain;
        }),
        rpc: vi.fn(),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const res = await app.request("/queue/sum-1/retry", { method: "POST" });

      expect(res.status).toBe(200);
      // rpc should NOT have been called — pending retry doesn't check rate limit
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });
  });
});
