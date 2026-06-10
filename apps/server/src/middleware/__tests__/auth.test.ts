import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createHash } from "crypto";
import type { AppEnv } from "../../env.js";

const PLAINTEXT = "cliphy_sk_testkey1234567890abcdef";
const HASH = createHash("sha256").update(PLAINTEXT).digest("hex");

const maybeSingle = vi.fn();
const getUser = vi.fn();
const eq = vi.fn();

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    auth: { getUser: (...a: unknown[]) => getUser(...a) },
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.update = vi.fn().mockReturnValue(chain);
      chain.eq = (...a: unknown[]) => {
        eq(...a);
        return chain;
      };
      chain.maybeSingle = (...a: unknown[]) => maybeSingle(...a);
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      return chain;
    }),
  },
}));

const { authMiddleware } = await import("../auth.js");

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use("*", authMiddleware);
  app.get("/whoami", (c) => c.json({ userId: c.get("userId"), method: c.get("authMethod") }));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authMiddleware api keys", () => {
  it("authenticates a valid cliphy_sk_ key by sha256 hash", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "key-1", user_id: "user-9" }, error: null });

    const res = await buildApp().request("/whoami", {
      headers: { Authorization: `Bearer ${PLAINTEXT}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-9", method: "api_key" });
    expect(getUser).not.toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("key_hash", HASH);
  });

  it("rejects an unknown cliphy_sk_ key", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await buildApp().request("/whoami", {
      headers: { Authorization: "Bearer cliphy_sk_wrong" },
    });

    expect(res.status).toBe(401);
  });

  it("falls through to supabase JWT for non-prefixed tokens", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "a@b.c" } }, error: null });

    const res = await buildApp().request("/whoami", {
      headers: { Authorization: "Bearer some.jwt.token" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-1", method: "jwt" });
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("rejects requests without a bearer token", async () => {
    const res = await buildApp().request("/whoami");
    expect(res.status).toBe(401);
  });
});
