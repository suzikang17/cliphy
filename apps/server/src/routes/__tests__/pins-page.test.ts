import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";

vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }));
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
const pinPageMock = vi.fn();
vi.mock("../../services/pin-page.js", () => ({ pinPage: (...a: unknown[]) => pinPageMock(...a) }));

const { pinsRoutes } = await import("../pins.js");
const app = () => new Hono().route("/pins", pinsRoutes);
const post = (body: unknown) =>
  app().request("/pins/page", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /pins/page", () => {
  beforeEach(() => {
    layer("unit");
    epic("Tabs view");
    feature("Pins");
    vi.clearAllMocks();
    allow = true;
  });

  it("returns 201 with pin + clip when created, 200 when it already existed", async () => {
    pinPageMock.mockResolvedValue({ pin: { id: "p1" }, clip: { id: "c1" }, created: true });
    let res = await post({ url: "https://a.com", title: "A", note: " n " });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      pin: { id: "p1" },
      clip: { id: "c1" },
      created: true,
    });
    expect(pinPageMock).toHaveBeenCalledWith({
      userId: "u1",
      url: "https://a.com",
      title: "A",
      note: "n",
    });

    pinPageMock.mockResolvedValue({ pin: { id: "p1" }, clip: { id: "c1" }, created: false });
    res = await post({ url: "https://a.com" });
    expect(res.status).toBe(200);
  });

  it("rejects non-web urls and rate-limits", async () => {
    expect((await post({ url: "chrome://newtab" })).status).toBe(400);
    allow = false;
    expect((await post({ url: "https://a.com" })).status).toBe(429);
    expect(pinPageMock).not.toHaveBeenCalled();
  });
});
