import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";

function mockChain(result: Record<string, unknown> = {}) {
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
    "or",
    "order",
    "range",
    "limit",
    "single",
    "maybeSingle",
  ];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  (chain as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(result);
  return chain;
}

let supabaseMock: { from: ReturnType<typeof vi.fn> };
vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get: (_: unknown, p: string) =>
        p === "from"
          ? (...a: unknown[]) => (supabaseMock.from as (...args: unknown[]) => unknown)(...a)
          : undefined,
    },
  ),
}));
vi.mock("../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "test-user-id");
      await next();
    },
  ),
}));

const { summaryRoutes } = await import("../summaries.js");

function app() {
  return new Hono().route("/api/summaries", summaryRoutes);
}

describe("archive routes", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Archive");
    vi.clearAllMocks();
  });

  it("archives a clip by stamping archived_at", async () => {
    const chain = mockChain({
      data: { id: "c1", archived_at: "2026-09-06T00:00:00Z" },
      error: null,
    });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/summaries/c1/archive", { method: "POST" });

    expect(res.status).toBe(200);
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: expect.any(String) }),
    );
  });

  it("unarchives a clip by nulling archived_at", async () => {
    const chain = mockChain({ data: { id: "c1", archived_at: null }, error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/summaries/c1/unarchive", { method: "POST" });

    expect(res.status).toBe(200);
    expect(chain.update).toHaveBeenCalledWith({ archived_at: null });
  });

  it("scopes the update to the calling user", async () => {
    const chain = mockChain({ data: { id: "c1", archived_at: null }, error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    await app().request("/api/summaries/c1/archive", { method: "POST" });

    expect(chain.eq).toHaveBeenCalledWith("user_id", "test-user-id");
  });

  it("returns 500 when the update fails", async () => {
    const chain = mockChain({ data: null, error: { message: "boom" } });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/summaries/c1/archive", { method: "POST" });

    expect(res.status).toBe(500);
  });
});
