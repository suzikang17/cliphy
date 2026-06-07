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
  const methods = [
    "select",
    "eq",
    "ilike",
    "order",
    "range",
    "is",
    "not",
    "single",
    "neq",
    "update",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

async function createApp() {
  const { adminUserRoutes } = await import("../users.js");
  const app = new Hono();
  app.route("/admin/users", adminUserRoutes);
  return app;
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "test@example.com",
    plan: "pro",
    subscription_status: "active",
    stripe_customer_id: null,
    stripe_subscription_id: null,
    trial_ends_at: null,
    monthly_summary_count: 0,
    monthly_count_reset_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("Admin Users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /admin/users returns user list page", async () => {
    mockFrom.mockReturnValue(
      mockChain({
        data: [
          {
            id: "u1",
            email: "test@example.com",
            plan: "free",
            subscription_status: "none",
            monthly_summary_count: 3,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        count: 1,
      }),
    );

    const app = await createApp();
    const res = await app.request("/admin/users");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("test@example.com");
    expect(html).toContain("free");
  });

  it("GET /admin/users/:id renders inline actions and linked summary titles", async () => {
    mockFrom
      .mockReturnValueOnce(mockChain({ data: userRow(), error: null })) // user
      .mockReturnValueOnce(
        mockChain({
          data: [
            {
              id: "s1",
              video_title: "My Video",
              status: "completed",
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
      ) // recent summaries
      .mockReturnValueOnce(mockChain({ count: 5 })); // total summaries

    const app = await createApp();
    const res = await app.request("/admin/users/u1");
    expect(res.status).toBe(200);
    const html = await res.text();
    // Inline action buttons live in the cards now (no separate Actions section)
    expect(html).toContain("Upgrade");
    expect(html).toContain("Downgrade");
    expect(html).toContain("Set");
    // Summary title links to the summary detail page
    expect(html).toContain('href="/api/admin/summaries/s1"');
    expect(html).toContain("My Video");
  });

  it("POST /admin/users/:id/upgrade sets plan to pro", async () => {
    const chain = mockChain({ data: userRow(), error: null });
    mockFrom.mockReturnValue(chain);

    const app = await createApp();
    const res = await app.request("/admin/users/u1/upgrade", { method: "POST" });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("User upgraded to Pro.");
    expect(chain.update).toHaveBeenCalledWith({ plan: "pro", subscription_status: "active" });
    expect(chain.eq).toHaveBeenCalledWith("id", "u1");
  });

  it("POST /admin/users/:id/downgrade resets plan to free (no Stripe sub)", async () => {
    // userRow has stripe_subscription_id: null, so no Stripe cancel is attempted.
    const chain = mockChain({
      data: userRow({ plan: "free", subscription_status: "none" }),
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const app = await createApp();
    const res = await app.request("/admin/users/u1/downgrade", { method: "POST" });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("User downgraded to Free.");
    expect(chain.update).toHaveBeenCalledWith({
      plan: "free",
      stripe_customer_id: null,
      stripe_subscription_id: null,
      subscription_status: "none",
    });
  });

  it("POST /admin/users/:id/set-count sets monthly count to a specific number", async () => {
    const chain = mockChain({ data: userRow({ monthly_summary_count: 42 }), error: null });
    mockFrom.mockReturnValue(chain);

    const app = await createApp();
    const res = await app.request("/admin/users/u1/set-count", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "count=42",
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Monthly count set to 42.");
    expect(chain.update).toHaveBeenCalledWith({ monthly_summary_count: 42 });
  });

  it("POST /admin/users/:id/set-count rejects invalid counts", async () => {
    mockFrom.mockReturnValue(mockChain({ data: userRow(), error: null }));

    const app = await createApp();
    const res = await app.request("/admin/users/u1/set-count", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "count=-3",
    });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Count must be a non-negative integer");
  });

  it("POST /admin/users/:id/upgrade surfaces DB errors", async () => {
    // The update fails; the follow-up re-fetch succeeds so the error renders in the cards.
    mockFrom
      .mockReturnValueOnce(mockChain({ error: { message: "boom" } }))
      .mockReturnValue(mockChain({ data: userRow(), error: null }));

    const app = await createApp();
    const res = await app.request("/admin/users/u1/upgrade", { method: "POST" });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Failed to upgrade: boom");
  });
});
