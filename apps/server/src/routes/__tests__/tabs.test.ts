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
const pageTags = {
  loadPageTags: vi.fn().mockResolvedValue(new Map()),
  saveAiAssignments: vi.fn().mockResolvedValue(undefined),
  setOverrides: vi.fn().mockResolvedValue(undefined),
  promoteProposal: vi.fn().mockResolvedValue(undefined),
};
vi.mock("../../services/page-tags.js", async (orig) => {
  const real = await orig<typeof import("../../services/page-tags.js")>();
  return {
    ...real, // pageKey + reusableAssignment are pure
    loadPageTags: (...a: unknown[]) => pageTags.loadPageTags(...a),
    saveAiAssignments: (...a: unknown[]) => pageTags.saveAiAssignments(...a),
    setOverrides: (...a: unknown[]) => pageTags.setOverrides(...a),
    promoteProposal: (...a: unknown[]) => pageTags.promoteProposal(...a),
  };
});
const cg = { closeGroup: vi.fn(), listClosedGroups: vi.fn(), resumeGroup: vi.fn() };
vi.mock("../../services/closed-groups.js", () => ({
  MAX_CLOSED_PAGES: 100,
  closeGroup: (...a: unknown[]) => cg.closeGroup(...a),
  listClosedGroups: (...a: unknown[]) => cg.listClosedGroups(...a),
  resumeGroup: (...a: unknown[]) => cg.resumeGroup(...a),
}));

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
    organizeMock.mockResolvedValue({ assignments: {}, done: [], sources: {} });
    pageTags.loadPageTags.mockResolvedValue(new Map());
  });

  it("POST /organize answers already-sorted pages from page_tags and runs AI only on new ones", async () => {
    fromImpl = () => mockChain({ data: [] });
    pageTags.loadPageTags.mockResolvedValue(
      new Map([
        [
          "https://x.com/1",
          {
            url: "https://x.com/1",
            ai_kind: "tag",
            ai_value: "design",
            ai_source: "jev",
            ai_at: new Date().toISOString(),
            done: true,
            override: "tag:freelance",
          },
        ],
      ]),
    );
    organizeMock.mockResolvedValue({
      assignments: { "2": { tag: "ai" } },
      done: [],
      sources: { "2": "jev" },
    });

    const res = await post({ tabs: [tab("1"), tab("2")] });
    const json = await res.json();

    expect(organizeMock.mock.calls[0][0].tabs.map((t: { key: string }) => t.key)).toEqual(["2"]);
    expect(json.assignments).toEqual({ "1": { tag: "design" }, "2": { tag: "ai" } });
    expect(json.done).toEqual(["1"]);
    expect(json.overrides).toEqual({ "1": "tag:freelance" });
    expect(pageTags.saveAiAssignments).toHaveBeenCalledWith("u1", [
      { url: "https://x.com/2", assignment: { tag: "ai" }, source: "jev", done: false },
    ]);
  });

  it("POST /organize skips AI when every page is known; never persists answers with no source", async () => {
    pageTags.loadPageTags.mockResolvedValue(
      new Map([
        [
          "https://x.com/1",
          {
            url: "https://x.com/1",
            ai_kind: "none",
            ai_value: null,
            ai_source: "claude",
            ai_at: new Date().toISOString(),
            done: false,
            override: null,
          },
        ],
      ]),
    );
    await post({ tabs: [tab("1")] });
    expect(organizeMock).not.toHaveBeenCalled();

    pageTags.loadPageTags.mockResolvedValue(new Map());
    fromImpl = () => mockChain({ data: [] });
    organizeMock.mockResolvedValue({ assignments: { "1": { none: true } }, done: [], sources: {} });
    await post({ tabs: [tab("1")] });
    expect(pageTags.saveAiAssignments).toHaveBeenLastCalledWith("u1", []);
  });

  it("PUT /overrides saves manual choices and rejects junk", async () => {
    const res = await app().request("/tabs/overrides", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          { url: "https://a.com", override: "tag:freelance" },
          { url: "https://b.com", override: null },
          { url: "chrome://x", override: "tag:x" },
          { url: "https://c.com", override: "bogus" },
        ],
      }),
    });
    expect(await res.json()).toEqual({ saved: 2 });
    expect(pageTags.setOverrides).toHaveBeenCalledWith("u1", [
      { url: "https://a.com", override: "tag:freelance" },
      { url: "https://b.com", override: null },
    ]);
    const empty = await app().request("/tabs/overrides", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [] }),
    });
    expect(empty.status).toBe(400);
  });

  it("PUT /hints/:tag with fromProposal promotes stored proposals to the tag", async () => {
    fromImpl = () => mockChain({ data: null, error: null });
    await app().request("/tabs/hints/freelance%3Alotus-bech", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hints: "", keep: true, fromProposal: "Project:Lotus-Bech" }),
    });
    expect(pageTags.promoteProposal).toHaveBeenCalledWith(
      "u1",
      "project:lotus-bech",
      "freelance:lotus-bech",
    );
  });

  describe("closed groups", () => {
    const put = (key: string, body: unknown) =>
      app().request(`/tabs/groups/${encodeURIComponent(key)}/close`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    it("closes, lists and resumes a group", async () => {
      cg.closeGroup.mockResolvedValue({ closedAt: "2026-10-10T10:00:00.000Z" });
      let res = await put("tag:freelance:lotus-bech", {
        label: "freelance › lotus-bech",
        pages: [{ url: "https://a.com", title: "A" }],
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ closedAt: "2026-10-10T10:00:00.000Z" });
      expect(cg.closeGroup).toHaveBeenCalledWith(
        "u1",
        "tag:freelance:lotus-bech",
        "freelance › lotus-bech",
        [{ url: "https://a.com", title: "A" }],
      );

      cg.listClosedGroups.mockResolvedValue([
        { key: "tag:x", label: "x", pages: [], closedAt: "t" },
      ]);
      expect(await (await app().request("/tabs/groups/closed")).json()).toEqual({
        groups: [{ key: "tag:x", label: "x", pages: [], closedAt: "t" }],
      });

      cg.resumeGroup.mockResolvedValue({
        key: "tag:x",
        label: "x",
        pages: [{ url: "https://a.com", title: "A" }],
        closedAt: "t",
      });
      res = await app().request("/tabs/groups/tag%3Ax/resume", { method: "POST" });
      expect(await res.json()).toEqual({ pages: [{ url: "https://a.com", title: "A" }] });
      expect(cg.resumeGroup).toHaveBeenCalledWith("u1", "tag:x");
      cg.resumeGroup.mockResolvedValue(null);
      expect((await app().request("/tabs/groups/nope/resume", { method: "POST" })).status).toBe(
        404,
      );
    });

    it("close validates label and pages (1–100 web urls, titles clamped)", async () => {
      expect((await put("tag:x", { label: "x", pages: [] })).status).toBe(400);
      expect((await put("tag:x", { pages: [{ url: "https://a.com", title: "A" }] })).status).toBe(
        400,
      );
      const many = Array.from({ length: 101 }, () => ({ url: "https://a.com", title: "A" }));
      expect((await put("tag:x", { label: "x", pages: many })).status).toBe(400);
      cg.closeGroup.mockResolvedValue({ closedAt: "t" });
      await put("tag:x", {
        label: "x",
        pages: [
          { url: "chrome://x", title: "no" },
          { url: "https://b.com", title: "y".repeat(400) },
        ],
      });
      const pages = cg.closeGroup.mock.calls.at(-1)![3];
      expect(pages).toHaveLength(1);
      expect(pages[0].title).toHaveLength(300);
    });
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
