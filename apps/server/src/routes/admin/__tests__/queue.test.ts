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
  const methods = ["select", "eq", "ilike", "order", "range", "is", "not", "single", "neq", "gte"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

async function createApp() {
  const { adminQueueRoutes } = await import("../queue.js");
  const app = new Hono();
  app.route("/admin/queue", adminQueueRoutes);
  return app;
}

describe("Admin Queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /admin/queue returns queue dashboard page", async () => {
    mockFrom.mockReturnValue(
      mockChain({
        data: [
          {
            id: "s1",
            video_title: "Test Video",
            youtube_video_id: "abc123",
            status: "completed",
            created_at: "2026-01-01T00:00:00Z",
            users: { email: "user@example.com" },
          },
        ],
        count: 5,
      }),
    );

    const app = await createApp();
    const res = await app.request("/admin/queue");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Queue");
    expect(html).toContain("Pending");
    expect(html).toContain("Processing");
    expect(html).toContain("Failed");
    expect(html).toContain("Completed Today");
  });

  it("GET /admin/queue shows recent items", async () => {
    mockFrom.mockReturnValue(
      mockChain({
        data: [
          {
            id: "s1",
            video_title: "Test Video",
            youtube_video_id: "abc123",
            status: "completed",
            created_at: "2026-01-01T00:00:00Z",
            users: { email: "user@example.com" },
          },
        ],
        count: 1,
      }),
    );

    const app = await createApp();
    const res = await app.request("/admin/queue");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Test Video");
    expect(html).toContain("user@example.com");
    expect(html).toContain("completed");
  });

  it("GET /admin/queue returns HTMX fragment when HX-Request header set", async () => {
    mockFrom.mockReturnValue(
      mockChain({
        data: [],
        count: 0,
      }),
    );

    const app = await createApp();
    const res = await app.request("/admin/queue", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("queue-content");
    expect(html).not.toContain("<html");
  });
});
