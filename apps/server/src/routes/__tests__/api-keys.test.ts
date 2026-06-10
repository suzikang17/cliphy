import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../env.js";

// ── Mock Supabase ─────────────────────────────────────────────

function mockChain(result: { data?: unknown; error?: unknown; count?: number | null } = {}) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "from",
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "order",
    "limit",
    "single",
    "maybeSingle",
  ];
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

let mockAuthMethod: "jwt" | "api_key" = "jwt";

vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    (c: { set: (k: string, v: string) => void }, next: () => unknown) => {
      c.set("userId", "user-123");
      c.set("userEmail", "test@example.com");
      c.set("authMethod", mockAuthMethod);
      return next();
    },
  ),
}));

const { apiKeyRoutes } = await import("../api-keys.js");

function buildApp() {
  const app = new Hono<AppEnv>();
  app.route("/keys", apiKeyRoutes);
  return app;
}

beforeEach(() => {
  supabaseMock = mockChain({ data: [], error: null });
  mockAuthMethod = "jwt";
  vi.clearAllMocks();
});

// ── GET / ─────────────────────────────────────────────────────

describe("GET /keys", () => {
  it("lists keys with prefix only", async () => {
    supabaseMock = mockChain({
      data: [
        {
          id: "key-1",
          name: "Shortcut",
          key_prefix: "cliphy_sk_abcd",
          last_used_at: null,
          created_at: "2026-06-09T00:00:00Z",
        },
      ],
      error: null,
    });

    const res = await buildApp().request("/keys");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { apiKeys: Array<{ keyPrefix: string }> };
    expect(body.apiKeys).toHaveLength(1);
    expect(body.apiKeys[0].keyPrefix).toBe("cliphy_sk_abcd");
    expect(JSON.stringify(body)).not.toContain("key_hash");
  });
});

// ── POST / ────────────────────────────────────────────────────

describe("POST /keys", () => {
  it("creates a key and returns plaintext once", async () => {
    // Sequence: count check → insert
    supabaseMock = mockChain({ data: null, error: null });
    (supabaseMock.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(mockChain({ data: null, error: null, count: 0 }))
      .mockReturnValueOnce(
        mockChain({
          data: {
            id: "key-1",
            name: "Shortcut",
            key_prefix: "cliphy_sk_abcd",
            last_used_at: null,
            created_at: "2026-06-09T00:00:00Z",
          },
          error: null,
        }),
      );

    const res = await buildApp().request("/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Shortcut" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { key: string; apiKey: { keyPrefix: string } };
    expect(body.key.startsWith("cliphy_sk_")).toBe(true);
    expect(body.key.length).toBeGreaterThan(30);
    expect(body.apiKey.keyPrefix).toBe("cliphy_sk_abcd");
  });

  it("enforces the per-user key cap", async () => {
    supabaseMock = mockChain({ data: null, error: null, count: 5 });

    const res = await buildApp().request("/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(422);
  });

  it("rejects api-key-authenticated callers", async () => {
    mockAuthMethod = "api_key";

    const res = await buildApp().request("/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /:id ───────────────────────────────────────────────

describe("DELETE /keys/:id", () => {
  it("deletes own key", async () => {
    supabaseMock = mockChain({ data: { id: "key-1" }, error: null });

    const res = await buildApp().request("/keys/key-1", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
  });

  it("returns 404 for someone else's key", async () => {
    supabaseMock = mockChain({ data: null, error: null });

    const res = await buildApp().request("/keys/not-mine", { method: "DELETE" });

    expect(res.status).toBe(404);
  });
});
