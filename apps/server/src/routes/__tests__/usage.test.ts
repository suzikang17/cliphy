import { describe, it, expect, vi, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { Hono } from "hono";
import type { AppEnv } from "../../env.js";

// ── Mock Supabase ─────────────────────────────────────────────

function mockChain(result: { data?: unknown; error?: unknown } = {}) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "select", "eq", "single", "is", "not"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

let userMockResult: ReturnType<typeof mockChain>;
let summariesMockResult: ReturnType<typeof mockChain>;

vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "auth") return { getUser: vi.fn() };
        if (prop === "from")
          return (table: string) => (table === "users" ? userMockResult : summariesMockResult);
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
      userMockResult = mockChain({
        data: { plan: "free", daily_summary_count: 3, daily_count_reset_at: today },
      });
      summariesMockResult = mockChain({ data: [] });

      const app = await createApp();
      const res = await app.request("/usage");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.usage.plan).toBe("free");
      expect(json.usage.used).toBe(3);
      expect(json.usage.limit).toBe(5);
      expect(json.usage.totalTimeSavedSeconds).toBe(0);
    });

    it("returns usage info for pro user", async () => {
      const today = new Date().toISOString().slice(0, 10);
      userMockResult = mockChain({
        data: { plan: "pro", daily_summary_count: 42, daily_count_reset_at: today },
      });
      summariesMockResult = mockChain({ data: [] });

      const app = await createApp();
      const res = await app.request("/usage");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.usage.plan).toBe("pro");
      expect(json.usage.used).toBe(42);
      expect(json.usage.limit).toBe(100);
    });

    it("resets count when reset date is in the past", async () => {
      userMockResult = mockChain({
        data: { plan: "free", daily_summary_count: 5, daily_count_reset_at: "2026-02-19" },
      });
      summariesMockResult = mockChain({ data: [] });

      const app = await createApp();
      const res = await app.request("/usage");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.usage.used).toBe(0); // reset because date is yesterday
    });

    it("includes total time saved from completed summaries", async () => {
      const today = new Date().toISOString().slice(0, 10);
      userMockResult = mockChain({
        data: { plan: "free", daily_summary_count: 2, daily_count_reset_at: today },
      });
      summariesMockResult = mockChain({
        data: [{ video_duration_seconds: 600 }, { video_duration_seconds: 1200 }],
      });

      const app = await createApp();
      const res = await app.request("/usage");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.usage.totalTimeSavedSeconds).toBe(1800);
    });

    it("returns 404 when user not found", async () => {
      userMockResult = mockChain({ data: null, error: { message: "not found" } });
      summariesMockResult = mockChain({ data: [] });

      const app = await createApp();
      const res = await app.request("/usage");

      expect(res.status).toBe(404);
    });
  });
});
