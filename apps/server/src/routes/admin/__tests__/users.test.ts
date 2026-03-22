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
  const methods = ["select", "eq", "ilike", "order", "range", "is", "not", "single", "neq"];
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
});
