import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";

function mockChain(result: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "delete", "upsert", "maybeSingle"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  (chain as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(result);
  return chain;
}

let fromImpl: (table: string) => unknown = () => mockChain();
vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: (t: string) => fromImpl(t) },
}));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "u1");
      await next();
    },
  ),
}));
const organizeMock = vi.fn();
vi.mock("../../services/tab-organizer.js", () => ({
  MAX_TABS: 60,
  organizeTabs: (...a: unknown[]) => organizeMock(...a),
}));
let allow = true;
vi.mock("../../lib/rateLimit.js", () => ({ checkRateLimit: vi.fn(() => allow) }));

const { tabsRoutes } = await import("../tabs.js");

function app() {
  const a = new Hono();
  a.route("/tabs", tabsRoutes);
  return a;
}
const post = (body: unknown) =>
  app().request("/tabs/organize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const tab = (key: string) => ({ key, url: `https://x.com/${key}`, title: key });

describe("tabs routes", () => {
  beforeEach(() => {
    layer("unit");
    epic("Tabs view");
    feature("Tabs API");
    vi.clearAllMocks();
    allow = true;
    organizeMock.mockResolvedValue({ assignments: {}, done: [] });
  });

  it("POST /organize passes ranked clip tags + hint-only tags and hints to the organizer", async () => {
    fromImpl = (t) =>
      t === "clips"
        ? mockChain({ data: [{ tags: ["b"] }, { tags: ["a", "b"] }] })
        : mockChain({
            data: [
              { tag: "client:new", hints: "", keywords: ["we curate life"] },
              { tag: "a", hints: "alpha" },
            ],
          });

    const res = await post({ tabs: [tab("1")] });

    expect(res.status).toBe(200);
    expect(organizeMock).toHaveBeenCalledWith({
      tabs: [{ key: "1", url: "https://x.com/1", title: "1" }],
      existingTags: ["b", "a", "client:new"],
      hints: { "client:new": "", a: "alpha" },
      keywords: { "client:new": ["we curate life"] },
      clusters: [],
    });
  });

  it("POST /organize validates worked-on-together clusters against the tabs sent", async () => {
    fromImpl = () => mockChain({ data: [] });
    await post({
      tabs: [tab("1"), tab("2"), tab("3")],
      clusters: [
        { keys: ["1", "2", "999"], start: 10, end: 20, switches: 6.7, openerLinks: 1 },
        { keys: ["3", "404"], start: 1, end: 2, switches: 1, openerLinks: 0 }, // only 1 known tab
        { keys: ["1", "3"], start: 50, end: 10, switches: 1, openerLinks: 0 }, // end < start
        "junk",
      ],
    });
    expect(organizeMock.mock.calls[0][0].clusters).toEqual([
      { keys: ["1", "2"], start: 10, end: 20, switches: 6, openerLinks: 1 },
    ]);
  });

  it("POST /organize clamps text and drops invalid tabs", async () => {
    fromImpl = () => mockChain({ data: [] });
    await post({
      tabs: [
        { ...tab("1"), text: "x".repeat(5000) },
        { key: "2", url: "chrome://settings", title: "s" },
        { key: "3", url: "https://y.com" }, // no title
      ],
    });
    const sent = organizeMock.mock.calls[0][0].tabs;
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toHaveLength(2000);
  });

  it("POST /organize rejects empty, oversized, and all-invalid batches", async () => {
    expect((await post({ tabs: [] })).status).toBe(400);
    expect(
      (await post({ tabs: Array.from({ length: 61 }, (_, i) => tab(String(i))) })).status,
    ).toBe(400);
    expect((await post({ tabs: [{ key: "1", url: "ftp://x", title: "t" }] })).status).toBe(400);
    expect(organizeMock).not.toHaveBeenCalled();
  });

  it("POST /organize returns 429 RATE_LIMITED when over the hourly limit", async () => {
    allow = false;
    const res = await post({ tabs: [tab("1")] });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("RATE_LIMITED");
    expect(organizeMock).not.toHaveBeenCalled();
  });

  it("PUT /hints/:tag upserts hints", async () => {
    const chain = mockChain({ data: null, error: null });
    fromImpl = () => chain;
    const res = await app().request(`/tabs/hints/${encodeURIComponent("Client:Acme")}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hints: "  acme.com  " }),
    });
    expect(res.status).toBe(200);
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", tag: "client:acme", hints: "acme.com" }),
      { onConflict: "user_id,tag" },
    );
  });

  it("PUT /hints/:tag with empty hints deletes — unless keep:true registers the tag", async () => {
    const chain = mockChain({ data: null, error: null }); // no existing keywords
    fromImpl = () => chain;
    const put = (body: unknown) =>
      app().request("/tabs/hints/reading", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    await put({ hints: "" });
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.upsert).not.toHaveBeenCalled();

    await put({ hints: "", keep: true });
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "reading", hints: "" }),
      { onConflict: "user_id,tag" },
    );
  });

  it("PUT /hints/:tag validates length", async () => {
    const res = await app().request("/tabs/hints/x", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hints: "x".repeat(501) }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /hints returns a tag → hints map", async () => {
    fromImpl = () =>
      mockChain({ data: [{ tag: "client:acme", hints: "acme.com", keywords: ["acme"] }] });
    const res = await app().request("/tabs/hints");
    expect(await res.json()).toEqual({
      hints: { "client:acme": "acme.com" },
      keywords: { "client:acme": ["acme"] },
    });
  });

  it("PUT /hints/:tag saves normalized keywords", async () => {
    const chain = mockChain({ data: null, error: null });
    fromImpl = () => chain;
    const res = await app().request("/tabs/hints/project%3Alotus-bech", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hints: "", keywords: [" We Curate Life ", "wecuratelife", "Lotus"] }),
    });
    expect(res.status).toBe(200);
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "project:lotus-bech",
        hints: "",
        keywords: ["we curate life", "lotus"],
      }),
      { onConflict: "user_id,tag" },
    );
    expect(chain.delete).not.toHaveBeenCalled();
  });

  it("PUT /hints/:tag clearing hints keeps a row that still has keywords", async () => {
    const chain = mockChain({ data: { keywords: ["lotus"] }, error: null });
    fromImpl = () => chain;
    await app().request("/tabs/hints/project%3Alotus-bech", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hints: "" }),
    });
    expect(chain.delete).not.toHaveBeenCalled();
    const row = (chain.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(row).not.toHaveProperty("keywords"); // omitted → untouched
  });

  it("PUT /hints/:tag rejects non-array keywords", async () => {
    fromImpl = () => mockChain({ data: null });
    const res = await app().request("/tabs/hints/x", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hints: "", keywords: "lotus" }),
    });
    expect(res.status).toBe(400);
  });
});
