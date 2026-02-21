import { describe, it, expect, vi, beforeEach } from "vitest";
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

// ── extractVideoId unit tests ─────────────────────────────────

describe("extractVideoId", () => {
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

// ── Route handler tests ───────────────────────────────────────

// Dynamically import to pick up mocks
async function createApp() {
  const { queueRoutes } = await import("../queue.js");
  const app = new Hono<AppEnv>().route("/queue", queueRoutes);
  return app;
}

describe("POST /queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds a video and returns 201 with summary and position", async () => {
    const row = {
      id: "sum-1",
      user_id: "test-user-id",
      youtube_video_id: "dQw4w9WgXcQ",
      video_url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
      status: "pending",
      summary_json: null,
      error_message: null,
      created_at: "2026-02-20T10:00:00Z",
      updated_at: "2026-02-20T10:00:00Z",
    };

    // duplicate check → not found
    const dupChain = mockChain({ data: null });
    // user plan check
    const planChain = mockChain({ data: { plan: "free" } });
    // rate limit rpc
    const rpcChain = mockChain({ data: true });
    // insert
    const insertChain = mockChain({ data: row });
    // position count
    const posChain = mockChain({ data: null, count: 0 });

    let callCount = 0;
    supabaseMock = {
      from: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return dupChain; // duplicate check
        if (callCount === 2) return planChain; // user plan
        if (callCount === 3) return insertChain; // insert
        if (callCount === 4) return posChain; // position
        return mockChain({});
      }),
      rpc: vi.fn().mockReturnValue(rpcChain),
    } as unknown as ReturnType<typeof mockChain>;

    const app = await createApp();
    const res = await app.request("/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl: "https://youtube.com/watch?v=dQw4w9WgXcQ" }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.summary.videoId).toBe("dQw4w9WgXcQ");
    expect(json.summary.status).toBe("pending");
    expect(json.position).toBe(1);
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

  it("returns 409 for duplicate video", async () => {
    const dupChain = mockChain({ data: { id: "existing", status: "pending" } });

    supabaseMock = {
      from: vi.fn().mockReturnValue(dupChain),
      rpc: vi.fn(),
    } as unknown as ReturnType<typeof mockChain>;

    const app = await createApp();
    const res = await app.request("/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl: "https://youtube.com/watch?v=dQw4w9WgXcQ" }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("DUPLICATE");
  });

  it("returns 429 when rate limited", async () => {
    const dupChain = mockChain({ data: null }); // no duplicate
    const planChain = mockChain({ data: { plan: "free" } });
    const rpcChain = mockChain({ data: false }); // rate limited

    let callCount = 0;
    supabaseMock = {
      from: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return dupChain;
        if (callCount === 2) return planChain;
        return mockChain({});
      }),
      rpc: vi.fn().mockReturnValue(rpcChain),
    } as unknown as ReturnType<typeof mockChain>;

    const app = await createApp();
    const res = await app.request("/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl: "https://youtube.com/watch?v=dQw4w9WgXcQ" }),
    });

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.code).toBe("RATE_LIMITED");
  });
});

describe("POST /queue/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for non-pro users", async () => {
    const userChain = mockChain({
      data: { plan: "free", daily_summary_count: 0, daily_count_reset_at: "2026-02-20" },
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

    expect(res.status).toBe(403);
  });

  it("returns 400 for more than 10 videos", async () => {
    supabaseMock = mockChain({});
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
    supabaseMock = mockChain({});
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
