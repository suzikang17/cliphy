import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.stubEnv("ADMIN_SECRET", "test-secret-123");

// Mock supabase
const mockFrom = vi.fn();
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: vi.fn() },
  },
}));

// Mock admin auth middleware (skip auth in tests)
vi.mock("../middleware.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware.js")>();
  return {
    ...actual,
    adminAuthMiddleware: vi.fn(async (_c: unknown, next: () => Promise<void>) => next()),
  };
});

type MockChain = Record<string, ReturnType<typeof vi.fn>> & {
  then: (resolve: (v: unknown) => void) => void;
};

function mockChain(result: { data?: unknown; error?: unknown; count?: number }) {
  const chain: MockChain = {} as MockChain;
  const methods = ["select", "eq", "ilike", "order", "range", "is", "not", "single", "neq", "or"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

async function createApp() {
  const { adminSummaryRoutes } = await import("../summaries.js");
  const app = new Hono();
  app.route("/admin/summaries", adminSummaryRoutes);
  return app;
}

describe("Admin Summaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /admin/summaries returns summary list page", async () => {
    mockFrom.mockReturnValue(
      mockChain({
        data: [
          {
            id: "s1",
            video_title: "Test Video",
            youtube_video_id: "abc123",
            status: "completed",
            tags: ["tech", "ai"],
            created_at: "2026-01-01T00:00:00Z",
            users: [{ email: "user@example.com" }],
          },
        ],
        count: 1,
      }),
    );

    const app = await createApp();
    const res = await app.request("/admin/summaries");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Test Video");
    expect(html).toContain("user@example.com");
    expect(html).toContain("completed");
  });

  it("GET /admin/summaries returns HTMX fragment when HX-Request header set", async () => {
    mockFrom.mockReturnValue(
      mockChain({
        data: [],
        count: 0,
      }),
    );

    const app = await createApp();
    const res = await app.request("/admin/summaries", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    // Fragment should have the table wrapper but not full page layout
    expect(html).toContain("summaries-table");
    expect(html).not.toContain("<html");
  });

  it("GET /admin/summaries/:id returns summary detail page", async () => {
    mockFrom.mockReturnValue(
      mockChain({
        data: {
          id: "s1",
          video_title: "Test Video",
          youtube_video_id: "abc123",
          video_channel: "Test Channel",
          video_duration_seconds: 300,
          status: "completed",
          tags: ["tech"],
          created_at: "2026-01-01T00:00:00Z",
          error_message: null,
          summary_json: { sections: [] },
          transcript: "Hello world transcript content here",
          users: { email: "user@example.com", plan: "pro", id: "u1" },
        },
        error: null,
      }),
    );

    const app = await createApp();
    const res = await app.request("/admin/summaries/s1");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Test Video");
    expect(html).toContain("Test Channel");
    expect(html).toContain("user@example.com");
    expect(html).toContain("abc123");
  });

  it("GET /admin/summaries/:id returns 404 for missing summary", async () => {
    mockFrom.mockReturnValue(
      mockChain({
        data: null,
        error: { message: "not found" },
      }),
    );

    const app = await createApp();
    const res = await app.request("/admin/summaries/nonexistent");
    expect(res.status).toBe(404);
  });
});
