import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../env.js";

// ── Mock Supabase ─────────────────────────────────────────────

function mockChain(result: { data?: unknown; error?: unknown } = {}) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "select", "update", "eq", "is", "single"];
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

// ── Mock Stripe service ───────────────────────────────────────

const mockCreateCheckoutSession = vi.fn().mockResolvedValue("https://checkout.stripe.com/session");
const mockCreatePortalSession = vi.fn().mockResolvedValue("https://billing.stripe.com/portal");
const mockCustomersCreate = vi.fn().mockResolvedValue({ id: "cus_new123" });

vi.mock("../../services/stripe.js", () => ({
  createCheckoutSession: (...args: unknown[]) => mockCreateCheckoutSession(...args),
  createPortalSession: (...args: unknown[]) => mockCreatePortalSession(...args),
  stripe: {
    customers: {
      create: (...args: unknown[]) => mockCustomersCreate(...args),
      del: vi.fn().mockResolvedValue({}),
    },
  },
}));

// ── App factory ───────────────────────────────────────────────

async function createApp() {
  const { billingRoutes } = await import("../billing.js");
  const app = new Hono<AppEnv>().route("/billing", billingRoutes);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────

describe("Billing", () => {
  describe("POST /billing/checkout", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("creates checkout session for user with existing Stripe customer", async () => {
      supabaseMock = mockChain({ data: { stripe_customer_id: "cus_existing" } });

      const app = await createApp();
      const res = await app.request("/billing/checkout", { method: "POST" });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.url).toBe("https://checkout.stripe.com/session");
      expect(mockCreateCheckoutSession).toHaveBeenCalledWith("cus_existing", "test-user-id");
      expect(mockCustomersCreate).not.toHaveBeenCalled();
    });

    it("creates Stripe customer when none exists, then creates checkout session", async () => {
      const selectChain = mockChain({ data: { stripe_customer_id: null } });
      // Race-safe update returns the updated row (non-null means we won the race)
      const updateChain = mockChain({ data: { stripe_customer_id: "cus_new123" } });

      let callCount = 0;
      supabaseMock = {
        from: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return selectChain;
          return updateChain;
        }),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const res = await app.request("/billing/checkout", { method: "POST" });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.url).toBe("https://checkout.stripe.com/session");
      expect(mockCustomersCreate).toHaveBeenCalledWith({
        email: "test@example.com",
        metadata: { userId: "test-user-id" },
      });
      expect(mockCreateCheckoutSession).toHaveBeenCalledWith("cus_new123", "test-user-id");
    });

    it("handles customer race condition by using existing customer", async () => {
      const selectChain = mockChain({ data: { stripe_customer_id: null } });
      // Race-safe update returns null (another request already set it)
      const updateChain = mockChain({ data: null });
      // Re-fetch gets the existing customer
      const refetchChain = mockChain({ data: { stripe_customer_id: "cus_winner" } });

      let callCount = 0;
      supabaseMock = {
        from: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return selectChain;
          if (callCount === 2) return updateChain;
          if (callCount === 3) return refetchChain;
          return mockChain({});
        }),
      } as unknown as ReturnType<typeof mockChain>;

      const app = await createApp();
      const res = await app.request("/billing/checkout", { method: "POST" });

      expect(res.status).toBe(200);
      // Should use the winner's customer ID, not the one we created
      expect(mockCreateCheckoutSession).toHaveBeenCalledWith("cus_winner", "test-user-id");
    });

    it("returns 500 when user lookup fails", async () => {
      supabaseMock = mockChain({ data: null, error: { message: "db error" } });

      const app = await createApp();
      const res = await app.request("/billing/checkout", { method: "POST" });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/look up user/i);
    });

    it("returns 500 when Stripe call fails", async () => {
      supabaseMock = mockChain({ data: { stripe_customer_id: "cus_existing" } });
      mockCreateCheckoutSession.mockRejectedValueOnce(new Error("Invalid URL"));

      const app = await createApp();
      const res = await app.request("/billing/checkout", { method: "POST" });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/checkout session/i);
    });
  });

  describe("POST /billing/portal", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("creates portal session for user with Stripe customer", async () => {
      supabaseMock = mockChain({ data: { stripe_customer_id: "cus_existing" } });

      const app = await createApp();
      const res = await app.request("/billing/portal", { method: "POST" });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.url).toBe("https://billing.stripe.com/portal");
      expect(mockCreatePortalSession).toHaveBeenCalledWith("cus_existing");
    });

    it("returns 400 when user has no Stripe customer", async () => {
      supabaseMock = mockChain({ data: { stripe_customer_id: null } });

      const app = await createApp();
      const res = await app.request("/billing/portal", { method: "POST" });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/no subscription/i);
    });

    it("returns 500 when user lookup fails", async () => {
      supabaseMock = mockChain({ data: null, error: { message: "db error" } });

      const app = await createApp();
      const res = await app.request("/billing/portal", { method: "POST" });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/look up user/i);
    });

    it("returns 500 when Stripe portal session creation fails", async () => {
      supabaseMock = mockChain({ data: { stripe_customer_id: "cus_existing" } });
      mockCreatePortalSession.mockRejectedValueOnce(new Error("Portal not configured"));

      const app = await createApp();
      const res = await app.request("/billing/portal", { method: "POST" });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/portal session/i);
    });
  });

  describe("GET /billing/success", () => {
    it("returns HTML success page", async () => {
      supabaseMock = mockChain({});
      const app = await createApp();
      const res = await app.request("/billing/success");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toContain("You're on Pro!");
    });
  });

  describe("GET /billing/cancel", () => {
    it("returns HTML cancel page", async () => {
      supabaseMock = mockChain({});
      const app = await createApp();
      const res = await app.request("/billing/cancel");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toContain("Checkout cancelled");
    });
  });
});
