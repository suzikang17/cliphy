import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import type { AppEnv } from "../../env.js";

const KEY = "cliphy_sk_testkey1234567890abcdef";
const RUN = "3f9a1c2e-0000-4000-8000-000000000001";

const maybeSingle = vi.fn();

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    auth: { getClaims: vi.fn() },
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "update", "or", "eq"]) chain[m] = () => chain;
      chain.maybeSingle = (...a: unknown[]) => maybeSingle(...a);
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      return chain;
    }),
  },
}));

const { authMiddleware, runnerMayCall } = await import("../auth.js");

function call(method: string, path: string) {
  const app = new Hono<AppEnv>();
  app.use("*", authMiddleware);
  app.all("*", (c) => c.json({ scope: c.get("keyScope") }));
  return app.request(path, { method, headers: { Authorization: `Bearer ${KEY}` } });
}

describe("a key limited to the runner", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Runner");
    vi.clearAllMocks();
  });

  it("may make the runner's four calls, with or without the /api prefix", () => {
    for (const prefix of ["", "/api"]) {
      for (const path of [
        "/coach/runs/claim",
        `/coach/runs/${RUN}/checkin`,
        `/coach/runs/${RUN}/finish`,
        "/coach/intake/upload-url",
      ]) {
        expect(runnerMayCall("POST", prefix + path), prefix + path).toBe(true);
      }
    }
  });

  it("may make no other call", () => {
    for (const path of [
      "/coach/people",
      "/coach/intake/messages",
      "/coach/chat",
      "/coach/runs",
      `/coach/runs/${RUN}/cancel`,
      `/coach/runs/${RUN}/finish/extra`,
      "/clips",
      "/keys",
    ]) {
      expect(runnerMayCall("POST", path), path).toBe(false);
    }
    expect(runnerMayCall("GET", "/coach/runs/claim")).toBe(false);
  });

  it("reaches a runner call, marked as a runner key", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "k1", user_id: "u1", scope: "runner" } });
    const res = await call("POST", "/coach/runs/claim");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scope: "runner" });
  });

  it("is refused everywhere else", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "k1", user_id: "u1", scope: "runner" } });
    const res = await call("GET", "/coach/people");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This key cannot do that" });
  });

  it("a key without a scope goes everywhere, as before", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "k1", user_id: "u1", scope: null } });
    for (const [method, path] of [
      ["POST", "/coach/runs/claim"],
      ["GET", "/coach/people"],
    ]) {
      const res = await call(method, path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ scope: null });
    }
  });
});
