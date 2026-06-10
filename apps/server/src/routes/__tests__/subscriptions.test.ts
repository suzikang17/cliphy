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
    "rpc",
    "upsert",
  ];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

let supabaseMock: ReturnType<typeof mockChain>;

vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get(_, prop) {
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
  authMiddleware: vi.fn((c: { set: (k: string, v: string) => void }, next: () => unknown) => {
    c.set("userId", "user-123");
    c.set("userEmail", "test@example.com");
    return next();
  }),
}));

vi.mock("../../middleware/require-pro.js", () => ({
  requirePro: vi.fn(() => (_c: unknown, next: () => unknown) => next()),
}));

vi.mock("../../services/youtube.js", () => ({
  parseSourceUrl: vi.fn().mockResolvedValue({
    type: "channel",
    sourceId: "UCtest",
    sourceName: "Test Channel",
    sourceUrl: "https://youtube.com/channel/UCtest",
  }),
  fetchChannelVideos: vi.fn().mockResolvedValue([]),
  fetchLikedVideos: vi.fn().mockResolvedValue([]),
  fetchPlaylistVideos: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../services/subscriptions.js", () => ({
  snapshotSeenVideos: vi.fn().mockResolvedValue(undefined),
  refreshGoogleTokenIfNeeded: vi.fn().mockResolvedValue("mock-token"),
  pollAndQueueSubscription: vi.fn().mockResolvedValue(undefined),
}));

const { subscriptionRoutes } = await import("../subscriptions.js");

function buildApp() {
  const app = new Hono<AppEnv>();
  app.route("/subscriptions", subscriptionRoutes);
  return app;
}

beforeEach(() => {
  supabaseMock = mockChain({ data: [], error: null });
  vi.clearAllMocks();
});

// ── GET / ─────────────────────────────────────────────────────

describe("GET /subscriptions", () => {
  it("returns list of subscriptions", async () => {
    supabaseMock = mockChain({
      data: [
        {
          id: "sub-1",
          user_id: "user-123",
          type: "channel",
          source_id: "UCtest",
          source_name: "Test Channel",
          source_url: "https://youtube.com/channel/UCtest",
          is_active: true,
          last_checked_at: null,
          skipped_count: 0,
          last_skipped_at: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ],
      error: null,
    });

    const res = await buildApp().request("/subscriptions");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscriptions: unknown[] };
    expect(body.subscriptions).toHaveLength(1);
  });

  it("returns empty array when no subscriptions", async () => {
    supabaseMock = mockChain({ data: [], error: null });

    const res = await buildApp().request("/subscriptions");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscriptions: unknown[] };
    expect(body.subscriptions).toHaveLength(0);
  });
});

// ── POST / ────────────────────────────────────────────────────

describe("POST /subscriptions", () => {
  const channelRow = {
    id: "sub-new",
    user_id: "user-123",
    type: "channel",
    source_id: "UCtest",
    source_name: "Test Channel",
    source_url: "https://youtube.com/channel/UCtest",
    is_active: true,
    last_checked_at: null,
    skipped_count: 0,
    last_skipped_at: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  };

  it("creates a channel subscription", async () => {
    // Sequence: count check → duplicate check → insert
    supabaseMock = mockChain({ data: null, error: null });
    (supabaseMock.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(mockChain({ data: null, error: null, count: 0 }))
      .mockReturnValueOnce(mockChain({ data: null, error: null }))
      .mockReturnValueOnce(mockChain({ data: channelRow, error: null }));

    const res = await buildApp().request("/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "channel",
        sourceUrl: "https://youtube.com/channel/UCtest",
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { subscription: { type: string } };
    expect(body.subscription.type).toBe("channel");
  });

  it("returns 400 for missing sourceUrl on channel type", async () => {
    const res = await buildApp().request("/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "channel" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid type", async () => {
    const res = await buildApp().request("/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "invalid", sourceUrl: "https://youtube.com/channel/UCtest" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 for duplicate subscription", async () => {
    // Sequence: count check (under limit) → duplicate check (found)
    supabaseMock = mockChain({ data: null, error: null });
    (supabaseMock.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(mockChain({ data: null, error: null, count: 0 }))
      .mockReturnValueOnce(mockChain({ data: { id: "existing-sub" }, error: null }));

    const res = await buildApp().request("/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "channel",
        sourceUrl: "https://youtube.com/channel/UCtest",
      }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await buildApp().request("/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("creates a liked subscription when Google is connected", async () => {
    const likedRow = {
      id: "sub-liked",
      user_id: "user-123",
      type: "liked",
      source_id: "LIKED",
      source_name: "Liked Videos",
      source_url: null,
      is_active: true,
      last_checked_at: null,
      skipped_count: 0,
      last_skipped_at: null,
      created_at: "2026-06-09T00:00:00Z",
      updated_at: "2026-06-09T00:00:00Z",
    };
    // Sequence: count check → google token row → duplicate check → insert
    supabaseMock = mockChain({ data: null, error: null });
    (supabaseMock.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(mockChain({ data: null, error: null, count: 0 }))
      .mockReturnValueOnce(mockChain({ data: { user_id: "user-123" }, error: null }))
      .mockReturnValueOnce(mockChain({ data: null, error: null }))
      .mockReturnValueOnce(mockChain({ data: likedRow, error: null }));

    const res = await buildApp().request("/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "liked" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      subscription: { type: string; sourceName: string };
    };
    expect(body.subscription.type).toBe("liked");
    expect(body.subscription.sourceName).toBe("Liked Videos");
  });

  it("rejects liked subscription without Google connection", async () => {
    // Sequence: count check → google token row (absent)
    supabaseMock = mockChain({ data: null, error: null });
    (supabaseMock.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(mockChain({ data: null, error: null, count: 0 }))
      .mockReturnValueOnce(mockChain({ data: null, error: null }));

    const res = await buildApp().request("/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "liked" }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("google_not_connected");
  });
});

// ── PATCH /:id ────────────────────────────────────────────────

describe("PATCH /subscriptions/:id", () => {
  it("pauses a subscription", async () => {
    supabaseMock = mockChain({
      data: {
        id: "sub-1",
        user_id: "user-123",
        type: "channel",
        source_id: "UCtest",
        source_name: "Test",
        source_url: null,
        is_active: false,
        last_checked_at: null,
        skipped_count: 0,
        last_skipped_at: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      error: null,
    });

    const res = await buildApp().request("/subscriptions/sub-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscription: { isActive: boolean } };
    expect(body.subscription.isActive).toBe(false);
  });

  it("returns 400 when no valid fields provided", async () => {
    const res = await buildApp().request("/subscriptions/sub-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /:id ───────────────────────────────────────────────

describe("DELETE /subscriptions/:id", () => {
  it("deletes a subscription", async () => {
    supabaseMock = mockChain({ data: { id: "sub-1" }, error: null });

    const res = await buildApp().request("/subscriptions/sub-1", { method: "DELETE" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  it("returns 404 when subscription not found", async () => {
    supabaseMock = mockChain({ data: null, error: { code: "PGRST116" } });

    const res = await buildApp().request("/subscriptions/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
