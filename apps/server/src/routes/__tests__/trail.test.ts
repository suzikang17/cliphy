import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";

vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "u1");
      await next();
    },
  ),
}));
let allow = true;
vi.mock("../../lib/rateLimit.js", () => ({ checkRateLimit: vi.fn(() => allow) }));
const svc = {
  captureTrail: vi.fn(),
  listTrail: vi.fn(),
  getTrailItem: vi.fn(),
  deleteTrailItem: vi.fn(),
  getRetentionDays: vi.fn(),
  setRetentionDays: vi.fn(),
};
vi.mock("../../services/trail.js", () => ({
  MAX_CAPTURE_BATCH: 50,
  MAX_RETENTION_DAYS: 3650,
  ...Object.fromEntries(Object.entries(svc).map(([k, fn]) => [k, (...a: unknown[]) => fn(...a)])),
}));
const quickSaveMock = vi.fn();
vi.mock("../../services/quick-save.js", () => ({
  quickSave: (...a: unknown[]) => quickSaveMock(...a),
}));

const { trailRoutes } = await import("../trail.js");
const app = () => new Hono().route("/trail", trailRoutes);
const json = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("trail routes", () => {
  beforeEach(() => {
    layer("unit");
    epic("Trail");
    feature("Trail API");
    vi.clearAllMocks();
    allow = true;
  });

  it("POST / captures valid items and drops invalid ones", async () => {
    svc.captureTrail.mockResolvedValue(1);
    const res = await app().request(
      "/trail",
      json("POST", {
        items: [
          { url: "https://a.com", title: "A", closedAt: 1, openedAt: 0 },
          { url: "chrome://newtab", title: "x", closedAt: 1 },
          { url: "https://b.com", title: "no closedAt" },
        ],
      }),
    );
    expect(await res.json()).toEqual({ saved: 1 });
    expect(svc.captureTrail).toHaveBeenCalledWith("u1", [
      { url: "https://a.com", title: "A", closedAt: 1, openedAt: 0 },
    ]);
  });

  it("POST / rejects empty or oversized batches and rate-limits", async () => {
    expect((await app().request("/trail", json("POST", { items: [] }))).status).toBe(400);
    const big = Array.from({ length: 51 }, (_, i) => ({ url: `https://a.com/${i}`, closedAt: 1 }));
    expect((await app().request("/trail", json("POST", { items: big }))).status).toBe(400);
    allow = false;
    const res = await app().request(
      "/trail",
      json("POST", { items: [{ url: "https://a.com", closedAt: 1 }] }),
    );
    expect(res.status).toBe(429);
  });

  it("GET / passes q, before and a clamped limit", async () => {
    svc.listTrail.mockResolvedValue({ items: [] });
    await app().request("/trail?q=lotus&limit=500&before=2026-10-10T10:00:00.000Z");
    expect(svc.listTrail).toHaveBeenCalledWith("u1", {
      q: "lotus",
      before: "2026-10-10T10:00:00.000Z",
      limit: 100,
    });
    expect((await app().request("/trail?before=nope")).status).toBe(400);
  });

  it("settings accept any 1–3650 days or forever, and reject the rest", async () => {
    svc.getRetentionDays.mockResolvedValue(null);
    expect(await (await app().request("/trail/settings")).json()).toEqual({ retentionDays: null });
    for (const ok of [1, 21, 180, 3650, null]) {
      const res = await app().request("/trail/settings", json("PUT", { retentionDays: ok }));
      expect(res.status).toBe(200);
      expect(svc.setRetentionDays).toHaveBeenLastCalledWith("u1", ok);
    }
    for (const bad of [0, 3651, 2.5, "30", undefined]) {
      const res = await app().request("/trail/settings", json("PUT", { retentionDays: bad }));
      expect(res.status).toBe(400);
    }
  });

  it("promote saves to clips then removes the trail entry", async () => {
    svc.getTrailItem.mockResolvedValue({ id: "t1", url: "https://a.com", title: "A" });
    quickSaveMock.mockResolvedValue({
      ok: true,
      clip: { id: "c1", tags: ["design"], created_at: "t", updated_at: "t" },
      tags: ["design"],
      suggestedTags: [],
    });
    const res = await app().request("/trail/t1/promote", { method: "POST" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ clip: { id: "c1" }, tags: ["design"] });
    expect(quickSaveMock).toHaveBeenCalledWith({
      userId: "u1",
      url: "https://a.com",
      title: "A",
      note: undefined,
    });
    expect(svc.deleteTrailItem).toHaveBeenCalledWith("u1", "t1");
  });

  it("promote/delete 404 for someone else's or missing entry", async () => {
    svc.getTrailItem.mockResolvedValue(null);
    expect((await app().request("/trail/x/promote", { method: "POST" })).status).toBe(404);
    svc.deleteTrailItem.mockResolvedValue(false);
    expect((await app().request("/trail/x", { method: "DELETE" })).status).toBe(404);
  });

  it("promote keeps your name as the clip title and your note as its notes", async () => {
    svc.getTrailItem.mockResolvedValue({
      id: "t2",
      url: "https://dashboard.stripe.com",
      title: "Dashboard – Stripe",
      customTitle: "Lotus invoice #3",
      note: "waiting on client",
    });
    quickSaveMock.mockResolvedValue({
      ok: true,
      clip: { id: "c2", tags: [], created_at: "t", updated_at: "t" },
      tags: [],
      suggestedTags: [],
    });
    await app().request("/trail/t2/promote", { method: "POST" });
    expect(quickSaveMock).toHaveBeenCalledWith({
      userId: "u1",
      url: "https://dashboard.stripe.com",
      title: "Lotus invoice #3",
      note: "waiting on client",
    });
  });

  it("POST / accepts a name and note per item", async () => {
    svc.captureTrail.mockResolvedValue(1);
    await app().request(
      "/trail",
      json("POST", {
        items: [
          { url: "https://a.com", title: "A", closedAt: 1, customTitle: " Mine ", note: "n" },
        ],
      }),
    );
    expect(svc.captureTrail.mock.calls[0][1][0]).toMatchObject({ customTitle: "Mine", note: "n" });
  });
});
