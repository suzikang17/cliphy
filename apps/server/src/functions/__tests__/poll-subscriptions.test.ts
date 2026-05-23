import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Capture Inngest handlers ──────────────────────────────────

type Handler = (ctx: unknown) => Promise<unknown>;
const capturedHandlers: Record<string, Handler> = {};
const mockInngestSend = vi.fn().mockResolvedValue(undefined);

vi.mock("../../lib/inngest.js", () => ({
  inngest: {
    createFunction: vi.fn((config: { id: string; triggers?: unknown[] }, handler: Handler) => {
      capturedHandlers[config.id] = handler;
      return { id: config.id };
    }),
    send: mockInngestSend,
  },
}));

// ── Mock Supabase ─────────────────────────────────────────────

function mockChain(result: { data?: unknown; error?: unknown } = {}) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "select", "eq", "single", "maybeSingle", "limit", "in", "neq", "is"];
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
        if (prop === "from")
          return (...args: unknown[]) =>
            (supabaseMock.from as (...a: unknown[]) => unknown)(...args);
        return undefined;
      },
    },
  ),
}));

// ── Mock subscriptions service ────────────────────────────────

const mockPollAndQueue = vi.fn().mockResolvedValue(undefined);

vi.mock("../../services/subscriptions.js", () => ({
  pollAndQueueSubscription: (...args: unknown[]) => mockPollAndQueue(...args),
}));

// Import after mocks are set up — this triggers createFunction calls
await import("../poll-subscriptions.js");

beforeEach(() => {
  supabaseMock = mockChain({ data: [], error: null });
  vi.clearAllMocks();
  mockInngestSend.mockResolvedValue(undefined);
  mockPollAndQueue.mockResolvedValue(undefined);
});

// ── pollSubscriptionsCron ─────────────────────────────────────

describe("pollSubscriptionsCron", () => {
  const cronHandler = () => capturedHandlers["poll-subscriptions-cron"];

  it("fans out one event per active subscription", async () => {
    supabaseMock = mockChain({
      data: [{ id: "sub-1" }, { id: "sub-2" }, { id: "sub-3" }],
      error: null,
    });

    const result = (await cronHandler()({})) as { dispatched: number };

    expect(result.dispatched).toBe(3);
    expect(mockInngestSend).toHaveBeenCalledOnce();
    const events = mockInngestSend.mock.calls[0][0] as unknown[];
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      name: "subscription/poll.requested",
      data: { subscriptionId: "sub-1" },
    });
  });

  it("returns dispatched: 0 when no active subscriptions", async () => {
    supabaseMock = mockChain({ data: [], error: null });

    const result = (await cronHandler()({})) as { dispatched: number };

    expect(result.dispatched).toBe(0);
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it("throws when DB query fails", async () => {
    supabaseMock = mockChain({ data: null, error: new Error("DB down") });

    await expect(cronHandler()({})).rejects.toThrow();
  });
});

// ── processSubscriptionPoll ───────────────────────────────────

describe("processSubscriptionPoll", () => {
  const workerHandler = () => capturedHandlers["process-subscription-poll"];

  it("calls pollAndQueueSubscription with the subscriptionId", async () => {
    const result = (await workerHandler()({
      event: { data: { subscriptionId: "sub-abc" } },
    })) as { subscriptionId: string };

    expect(mockPollAndQueue).toHaveBeenCalledWith("sub-abc");
    expect(result.subscriptionId).toBe("sub-abc");
  });

  it("propagates errors from pollAndQueueSubscription", async () => {
    mockPollAndQueue.mockRejectedValueOnce(new Error("YouTube API error"));

    await expect(
      workerHandler()({ event: { data: { subscriptionId: "sub-fail" } } }),
    ).rejects.toThrow("YouTube API error");
  });
});
