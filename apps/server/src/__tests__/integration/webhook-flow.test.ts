import { describe, it, expect, vi, beforeEach } from "vitest";
import { epic, feature, layer, severity, story } from "allure-js-commons";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type Stripe from "stripe";
import type { AppEnv } from "../../env.js";

/**
 * Integration test for the webhook flow.
 *
 * Instead of importing the full app (which pulls in Inngest serve() and other
 * complex side effects), we build a minimal Hono app that mounts billingRoutes
 * with the same middleware chain as the real app. This tests:
 *   - Webhook signature verification → handler → error → 500 flow
 *   - syncSubscription 0-row detection
 *   - Webhook try/catch + Sentry flush
 *   - checkout.session.completed full flow
 */

// ── Mocks ────────────────────────────────────────────────────

function mockChain(result: { data?: unknown; error?: unknown } = {}) {
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
    "contains",
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

let fromMock: ReturnType<typeof vi.fn>;

vi.mock("../../lib/supabase.js", () => {
  fromMock = vi.fn().mockReturnValue(mockChain({}));
  return {
    supabase: {
      from: (...args: unknown[]) => fromMock(...args),
      rpc: vi.fn().mockReturnValue(mockChain({})),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "u1", email: "a@b.com" } },
          error: null,
        }),
      },
    },
  };
});

const mockConstructEvent = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();

vi.mock("../../services/stripe.js", () => ({
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  stripe: {
    webhooks: { constructEvent: (...args: unknown[]) => mockConstructEvent(...args) },
    customers: { create: vi.fn(), del: vi.fn() },
    subscriptions: { retrieve: (...args: unknown[]) => mockSubscriptionsRetrieve(...args) },
  },
}));

const mockSentryCapture = vi.fn();
const mockSentryFlush = vi.fn().mockResolvedValue(true);

vi.mock("../../lib/sentry.js", () => ({
  Sentry: {
    captureException: (...args: unknown[]) => mockSentryCapture(...args),
    flush: (...args: unknown[]) => mockSentryFlush(...args),
    addBreadcrumb: vi.fn(),
    init: vi.fn(),
  },
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

// ── Helpers ──────────────────────────────────────────────────

function makeSubscriptionEvent(
  type: string,
  subscription: Partial<Stripe.Subscription>,
): Stripe.Event {
  return {
    id: "evt_test",
    type,
    data: { object: subscription as Stripe.Subscription },
  } as unknown as Stripe.Event;
}

function makeCheckoutEvent(session: Partial<Stripe.Checkout.Session>): Stripe.Event {
  return {
    id: "evt_test",
    type: "checkout.session.completed",
    data: { object: session as Stripe.Checkout.Session },
  } as unknown as Stripe.Event;
}

async function createApp() {
  const { billingRoutes } = await import("../../routes/billing.js");
  const app = new Hono<AppEnv>();

  // Mount with CORS like the real app, so we test the full middleware chain
  app.use(
    "*",
    cors({
      origin: ["chrome-extension://test"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );
  app.route("/billing", billingRoutes);
  return app;
}

async function sendWebhook(app: Awaited<ReturnType<typeof createApp>>, body = "{}") {
  return app.request("/billing/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": "t=123,v1=abc",
    },
    body,
  });
}

// ── Tests ────────────────────────────────────────────────────

describe("Webhook flow integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    layer("integration");
    epic("Billing");
    feature("Stripe Webhooks");
  });

  describe("signature verification", () => {
    beforeEach(() => story("Signature Verification"));
    it("returns 400 when signature is missing", async () => {
      const app = await createApp();
      const res = await app.request("/billing/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/signature/i);
    });

    it("returns 400 when signature is invalid", async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error("Invalid signature");
      });

      const app = await createApp();
      const res = await sendWebhook(app);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid signature/i);
    });
  });

  describe("subscription events", () => {
    beforeEach(() => story("Subscription Sync"));
    it("returns 200 when syncSubscription succeeds", async () => {
      const event = makeSubscriptionEvent("customer.subscription.updated", {
        id: "sub_123",
        customer: "cus_123",
        status: "active",
        trial_end: null,
      });
      mockConstructEvent.mockReturnValue(event);

      // syncSubscription update returns matched rows
      fromMock.mockReturnValue(mockChain({ data: [{ id: "user-1" }] }));

      const app = await createApp();
      const res = await sendWebhook(app);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.received).toBe(true);
    });

    it("returns 500 when syncSubscription matches 0 rows", async () => {
      severity("critical");
      const event = makeSubscriptionEvent("customer.subscription.updated", {
        id: "sub_orphan",
        customer: "cus_unknown",
        status: "active",
        trial_end: null,
      });
      mockConstructEvent.mockReturnValue(event);

      // syncSubscription update returns 0 rows (no matching customer)
      fromMock.mockReturnValue(mockChain({ data: [] }));

      const app = await createApp();
      const res = await sendWebhook(app);

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/webhook handler failed/i);

      // Sentry should capture the 0-row error
      expect(mockSentryCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("matched 0 rows"),
        }),
        expect.anything(),
      );
      // Sentry.flush must be called in the webhook error path
      expect(mockSentryFlush).toHaveBeenCalledWith(2000);
    });

    it("returns 500 when Supabase update fails", async () => {
      const event = makeSubscriptionEvent("customer.subscription.deleted", {
        id: "sub_123",
        customer: "cus_123",
        status: "canceled",
        trial_end: null,
      });
      mockConstructEvent.mockReturnValue(event);

      // syncSubscription update returns a Supabase error
      fromMock.mockReturnValue(mockChain({ data: null, error: { message: "DB unavailable" } }));

      const app = await createApp();
      const res = await sendWebhook(app);

      expect(res.status).toBe(500);
      expect(mockSentryCapture).toHaveBeenCalled();
      expect(mockSentryFlush).toHaveBeenCalledWith(2000);
    });
  });

  describe("checkout.session.completed", () => {
    beforeEach(() => story("Checkout Completion"));
    it("returns 500 when customer link fails", async () => {
      const event = makeCheckoutEvent({
        mode: "subscription",
        subscription: "sub_123",
        customer: "cus_123",
        client_reference_id: "user-1",
      });
      mockConstructEvent.mockReturnValue(event);

      // customer link update fails
      fromMock.mockReturnValue(
        mockChain({ data: null, error: { message: "constraint violation" } }),
      );

      const app = await createApp();
      const res = await sendWebhook(app);

      expect(res.status).toBe(500);
      expect(mockSentryCapture).toHaveBeenCalled();
    });

    it("returns 200 for non-subscription mode checkout (ignored)", async () => {
      const event = makeCheckoutEvent({
        mode: "payment",
        subscription: null,
        customer: "cus_123",
        client_reference_id: "user-1",
      });
      mockConstructEvent.mockReturnValue(event);

      const app = await createApp();
      const res = await sendWebhook(app);

      expect(res.status).toBe(200);
    });

    it("links customer and syncs subscription on success", async () => {
      const event = makeCheckoutEvent({
        mode: "subscription",
        subscription: "sub_new",
        customer: "cus_new",
        client_reference_id: "user-1",
      });
      mockConstructEvent.mockReturnValue(event);

      // customer link succeeds, then syncSubscription succeeds
      let callCount = 0;
      fromMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockChain({}); // customer link
        return mockChain({ data: [{ id: "user-1" }] }); // sync sub
      });

      mockSubscriptionsRetrieve.mockResolvedValue({
        id: "sub_new",
        customer: "cus_new",
        status: "active",
        trial_end: null,
      });

      const app = await createApp();
      const res = await sendWebhook(app);

      expect(res.status).toBe(200);
      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith("sub_new");
    });
  });

  describe("unhandled event types", () => {
    it("returns 200 for unknown event types", async () => {
      const event = {
        id: "evt_test",
        type: "some.unknown.event",
        data: { object: {} },
      } as unknown as Stripe.Event;
      mockConstructEvent.mockReturnValue(event);

      const app = await createApp();
      const res = await sendWebhook(app);

      expect(res.status).toBe(200);
    });
  });
});
