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
    "upsert",
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

vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn((c: { set: (k: string, v: string) => void }, next: () => unknown) => {
    c.set("userId", "user-123");
    c.set("userEmail", "test@example.com");
    return next();
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { authGoogleRoutes } = await import("../auth-google.js");

function buildApp() {
  const app = new Hono<AppEnv>();
  app.route("/auth/google", authGoogleRoutes);
  return app;
}

beforeEach(() => {
  supabaseMock = mockChain({ data: null, error: null });
  vi.clearAllMocks();
});

// ── GET /status ───────────────────────────────────────────────

describe("GET /auth/google/status", () => {
  it("returns connected: true when token exists", async () => {
    supabaseMock = mockChain({ data: { user_id: "user-123" }, error: null });

    const res = await buildApp().request("/auth/google/status");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: boolean };
    expect(body.connected).toBe(true);
  });

  it("returns connected: false when no token", async () => {
    supabaseMock = mockChain({ data: null, error: null });

    const res = await buildApp().request("/auth/google/status");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: boolean };
    expect(body.connected).toBe(false);
  });
});

// ── GET / (initiate) ──────────────────────────────────────────

describe("GET /auth/google", () => {
  it("returns Google OAuth URL as JSON", async () => {
    supabaseMock = mockChain({ data: null, error: null });

    const res = await buildApp().request("/auth/google");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(body.url).toContain("youtube.readonly");
    expect(body.url).toContain("state=");
  });
});

// ── GET /callback ─────────────────────────────────────────────

describe("GET /auth/google/callback", () => {
  const validStateRow = {
    user_id: "user-123",
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };

  it("exchanges code and redirects to web app on success", async () => {
    (supabaseMock.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(mockChain({ data: validStateRow, error: null })) // state lookup
      .mockReturnValueOnce(mockChain({ data: null, error: null })) // delete state
      .mockReturnValueOnce(mockChain({ data: null, error: null })); // upsert tokens

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/youtube.readonly",
      }),
    });

    const res = await buildApp().request("/auth/google/callback?code=auth-code&state=some-state");

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("google_connected=true");
  });

  it("redirects with error when state is missing", async () => {
    const res = await buildApp().request("/auth/google/callback?code=auth-code");

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("google_error");
  });

  it("redirects with error when state is not found in DB", async () => {
    supabaseMock = mockChain({ data: null, error: null });

    const res = await buildApp().request("/auth/google/callback?code=auth-code&state=bad-state");

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("google_error");
  });

  it("redirects with error when token exchange fails", async () => {
    (supabaseMock.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(mockChain({ data: validStateRow, error: null }))
      .mockReturnValueOnce(mockChain({ data: null, error: null }));

    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

    const res = await buildApp().request("/auth/google/callback?code=bad-code&state=some-state");

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("google_error");
  });

  it("redirects with error when Google returns error param", async () => {
    const res = await buildApp().request(
      "/auth/google/callback?error=access_denied&state=some-state",
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("google_error");
  });
});

// ── DELETE / ──────────────────────────────────────────────────

describe("DELETE /auth/google", () => {
  it("disconnects and deactivates watch_later subscriptions", async () => {
    (supabaseMock.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(mockChain({ data: { access_token: "old-token" }, error: null })) // token lookup
      .mockReturnValueOnce(mockChain({ data: null, error: null })) // delete token
      .mockReturnValueOnce(mockChain({ data: null, error: null })); // deactivate subs

    mockFetch.mockResolvedValueOnce({ ok: true });

    const res = await buildApp().request("/auth/google", { method: "DELETE" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { disconnected: boolean };
    expect(body.disconnected).toBe(true);
  });

  it("succeeds even when no token exists", async () => {
    (supabaseMock.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(mockChain({ data: null, error: null })) // token lookup (none)
      .mockReturnValueOnce(mockChain({ data: null, error: null })) // delete token
      .mockReturnValueOnce(mockChain({ data: null, error: null })); // deactivate subs

    const res = await buildApp().request("/auth/google", { method: "DELETE" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { disconnected: boolean };
    expect(body.disconnected).toBe(true);
  });
});
