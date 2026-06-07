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

  it("POST /admin/users/:id/upgrade sets plan to pro", async () => {
    const chain = mockChain({ error: null });
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
    // First call: fetch user (no stripe sub). Second call: update row.
    const fetchChain = mockChain({ data: { stripe_subscription_id: null }, error: null });
    const updateChain = mockChain({ error: null });
    mockFrom.mockReturnValueOnce(fetchChain).mockReturnValueOnce(updateChain);

    const app = await createApp();
    const res = await app.request("/admin/users/u1/downgrade", { method: "POST" });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("User downgraded to Free.");
    expect(updateChain.update).toHaveBeenCalledWith({
      plan: "free",
      stripe_customer_id: null,
      stripe_subscription_id: null,
      subscription_status: "none",
    });
  });

  it("POST /admin/users/:id/upgrade surfaces DB errors", async () => {
    mockFrom.mockReturnValue(mockChain({ error: { message: "boom" } }));

    const app = await createApp();
    const res = await app.request("/admin/users/u1/upgrade", { method: "POST" });

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Failed to upgrade: boom");
  });
});
