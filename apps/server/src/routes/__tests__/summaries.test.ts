import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../env.js";

// ── Mock Supabase ─────────────────────────────────────────────

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
    "ilike",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

let fromCallCount = 0;
let fromResults: ReturnType<typeof mockChain>[] = [];

vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "auth") return { getUser: vi.fn() };
        if (prop === "from") {
          return () => {
            const result = fromResults[fromCallCount] ?? mockChain({});
            fromCallCount++;
            return result;
          };
        }
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

async function createApp() {
  const { summaryRoutes } = await import("../summaries.js");
  const app = new Hono<AppEnv>().route("/summaries", summaryRoutes);
  return app;
}

const sampleRow = {
  id: "sum-1",
  user_id: "test-user-id",
  youtube_video_id: "abc12345678",
  video_title: "Test Video",
  video_url: "https://youtube.com/watch?v=abc12345678",
  status: "completed",
  summary_json: { summary: "A test summary", keyPoints: ["Point 1"], timestamps: ["0:00 - Start"] },
  error_message: null,
  deleted_at: null,
  created_at: "2026-02-20T10:00:00Z",
  updated_at: "2026-02-20T10:00:00Z",
};

// ── Tests ─────────────────────────────────────────────────────

describe("GET /summaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromCallCount = 0;
    fromResults = [];
  });

  it("returns paginated list of summaries", async () => {
    // 1st from() → users table (plan check)
    fromResults.push(mockChain({ data: { plan: "pro" } }));
    // 2nd from() → summaries table (list)
    fromResults.push(mockChain({ data: [sampleRow], count: 1 }));

    const app = await createApp();
    const res = await app.request("/summaries");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summaries).toHaveLength(1);
    expect(json.summaries[0].videoId).toBe("abc12345678");
    expect(json.total).toBe(1);
    expect(json.offset).toBe(0);
    expect(json.limit).toBe(20);
  });

  it("respects limit and offset params", async () => {
    fromResults.push(mockChain({ data: { plan: "pro" } }));
    fromResults.push(mockChain({ data: [], count: 0 }));

    const app = await createApp();
    const res = await app.request("/summaries?limit=5&offset=10");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.limit).toBe(5);
    expect(json.offset).toBe(10);
  });

  it("caps limit at 100", async () => {
    fromResults.push(mockChain({ data: { plan: "pro" } }));
    fromResults.push(mockChain({ data: [], count: 0 }));

    const app = await createApp();
    const res = await app.request("/summaries?limit=999");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.limit).toBe(100);
  });
});

describe("GET /summaries/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromCallCount = 0;
    fromResults = [];
  });

  it("returns summary detail", async () => {
    fromResults.push(mockChain({ data: sampleRow }));

    const app = await createApp();
    const res = await app.request("/summaries/sum-1");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary.videoId).toBe("abc12345678");
    expect(json.summary.summaryJson.keyPoints).toHaveLength(1);
  });

  it("returns 404 for non-existent summary", async () => {
    fromResults.push(mockChain({ data: null, error: { message: "not found" } }));

    const app = await createApp();
    const res = await app.request("/summaries/nonexistent");

    expect(res.status).toBe(404);
  });
});

describe("GET /summaries/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromCallCount = 0;
    fromResults = [];
  });

  it("returns 400 when q parameter is missing", async () => {
    const app = await createApp();
    const res = await app.request("/summaries/search");

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/q.*required/i);
  });

  it("searches summaries by query", async () => {
    fromResults.push(mockChain({ data: { plan: "pro" } }));
    fromResults.push(mockChain({ data: [sampleRow], count: 1 }));

    const app = await createApp();
    const res = await app.request("/summaries/search?q=test");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summaries).toHaveLength(1);
    expect(json.total).toBe(1);
  });
});

describe("DELETE /summaries/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromCallCount = 0;
    fromResults = [];
  });

  it("soft-deletes a summary", async () => {
    fromResults.push(mockChain({ data: { id: "sum-1" } }));

    const app = await createApp();
    const res = await app.request("/summaries/sum-1", { method: "DELETE" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(true);
    expect(json.id).toBe("sum-1");
  });

  it("returns 404 for non-existent or already deleted summary", async () => {
    fromResults.push(mockChain({ data: null, error: { message: "not found" } }));

    const app = await createApp();
    const res = await app.request("/summaries/nonexistent", { method: "DELETE" });

    expect(res.status).toBe(404);
  });
});
