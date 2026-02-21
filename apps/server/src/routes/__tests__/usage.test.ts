import { describe, it, expect, vi, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { Hono } from "hono";
import type { AppEnv } from "../../env.js";

// ── Mock Supabase ─────────────────────────────────────────────

function mockChain(result: { data?: unknown; error?: unknown } = {}) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "select", "eq", "single"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

let mockResult: ReturnType<typeof mockChain>;

vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "auth") return { getUser: vi.fn() };
        if (prop === "from") return () => mockResult;
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
  const { usageRoutes } = await import("../usage.js");
  const app = new Hono<AppEnv>().route("/usage", usageRoutes);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────

describe("Billing", () => {
  describe("GET /usage", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      layer("unit");
      epic("Billing");
      feature("Usage Tracking");
    });

    it("returns usage info for free user", async () => {
      const today = new Date().toISOString().slice(0, 10);
      mockResult = mockChain({
        data: { plan: "free", daily_summary_count: 3, daily_count_reset_at: today },
      });

      const app = await createApp();
      const res = await app.request("/usage");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.usage.plan).toBe("free");
      expect(json.usage.used).toBe(3);
      expect(json.usage.limit).toBe(5);
    });

    it("returns usage info for pro user", async () => {
      const today = new Date().toISOString().slice(0, 10);
      mockResult = mockChain({
        data: { plan: "pro", daily_summary_count: 42, daily_count_reset_at: today },
      });

      const app = await createApp();
      const res = await app.request("/usage");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.usage.plan).toBe("pro");
      expect(json.usage.used).toBe(42);
      expect(json.usage.limit).toBe(100);
    });

    it("resets count when reset date is in the past", async () => {
      mockResult = mockChain({
        data: { plan: "free", daily_summary_count: 5, daily_count_reset_at: "2026-02-19" },
      });

      const app = await createApp();
      const res = await app.request("/usage");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.usage.used).toBe(0); // reset because date is yesterday
    });

    it("returns 404 when user not found", async () => {
      mockResult = mockChain({ data: null, error: { message: "not found" } });

      const app = await createApp();
      const res = await app.request("/usage");

      expect(res.status).toBe(404);
    });
  });
});
