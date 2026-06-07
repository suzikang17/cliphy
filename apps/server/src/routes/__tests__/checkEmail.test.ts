import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../env.js";

let rpcResult: { data: unknown; error: unknown } = { data: "new", error: null };

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    rpc: vi.fn(async () => rpcResult),
  },
}));

vi.mock("../../lib/rateLimit.js", () => ({
  checkRateLimit: vi.fn(() => true),
}));

import { authRoutes } from "../auth.js";
import { checkRateLimit } from "../../lib/rateLimit.js";

function app() {
  const a = new Hono<AppEnv>();
  a.route("/auth", authRoutes);
  return a;
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  return app().request("/auth/check-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /auth/check-email", () => {
  beforeEach(() => {
    rpcResult = { data: "new", error: null };
    vi.mocked(checkRateLimit).mockReturnValue(true);
  });

  it("returns the status from the rpc", async () => {
    rpcResult = { data: "password", error: null };
    const res = await post({ email: "user@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "password" });
  });

  it("returns 400 for a malformed email", async () => {
    const res = await post({ email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when email is missing", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    vi.mocked(checkRateLimit).mockReturnValue(false);
    const res = await post({ email: "user@example.com" });
    expect(res.status).toBe(429);
  });

  it("returns 500 when the rpc errors", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    const res = await post({ email: "user@example.com" });
    expect(res.status).toBe(500);
  });
});
