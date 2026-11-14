import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";

function mockChain(result: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "single", "maybeSingle"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  (chain as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(result);
  return chain;
}

let supabaseMock: { from: ReturnType<typeof vi.fn> };
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: (...a: unknown[]) => (supabaseMock.from as (...args: unknown[]) => unknown)(...a),
  },
}));

const { requireCoach } = await import("../require-coach.js");

function app() {
  const a = new Hono<{ Variables: { userId: string } }>();
  a.use("*", async (c, next) => {
    c.set("userId", "test-user-id");
    await next();
  });
  a.use("*", requireCoach as never);
  a.get("/x", (c) => c.json({ ok: true }));
  return a;
}

describe("requireCoach", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Account switch");
  });

  it("403s with coach_not_enabled when the account's switch is off", async () => {
    supabaseMock = {
      from: vi.fn(() => mockChain({ data: { coach_enabled: false }, error: null })),
    };
    const res = await app().request("/x");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "coach_not_enabled" });
  });

  it("403s when the user row is missing", async () => {
    supabaseMock = { from: vi.fn(() => mockChain({ data: null, error: null })) };
    expect((await app().request("/x")).status).toBe(403);
  });

  it("passes through when the switch is on", async () => {
    supabaseMock = {
      from: vi.fn(() => mockChain({ data: { coach_enabled: true }, error: null })),
    };
    expect((await app().request("/x")).status).toBe(200);
  });
});
