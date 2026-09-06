import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";

function mockChain(result: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "from",
    "select",
    "insert",
    "update",
    "upsert",
    "delete",
    "eq",
    "neq",
    "in",
    "is",
    "or",
    "order",
    "range",
    "limit",
    "single",
    "maybeSingle",
  ];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  (chain as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(result);
  return chain;
}

let supabaseMock: { from: ReturnType<typeof vi.fn> };
vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get: (_: unknown, p: string) =>
        p === "from"
          ? (...a: unknown[]) => (supabaseMock.from as (...args: unknown[]) => unknown)(...a)
          : undefined,
    },
  ),
}));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "test-user-id");
      await next();
    },
  ),
}));
const runViewQuery = vi.fn(async () => []);
vi.mock("../../services/viewQuery.js", async () => {
  const actual = await vi.importActual<typeof import("../../services/viewQuery.js")>(
    "../../services/viewQuery.js",
  );
  return { sanitizeViewQuery: actual.sanitizeViewQuery, runViewQuery };
});

const { pinsRoutes } = await import("../pins.js");

function app() {
  return new Hono().route("/api/pins", pinsRoutes);
}

function post(path: string, body: unknown) {
  return app().request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("pins routes", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Pins");
    vi.clearAllMocks();
  });

  it("lists pins ordered by position", async () => {
    const chain = mockChain({ data: [], error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/pins");

    expect(res.status).toBe(200);
    expect(chain.order).toHaveBeenCalledWith("position", { ascending: true });
  });

  it("creates a clip pin", async () => {
    const chain = mockChain({
      data: {
        id: "p1",
        user_id: "test-user-id",
        kind: "clip",
        layout: "tile",
        position: 0,
        clip_id: "c1",
        pinned_at: "t",
        updated_at: "t",
      },
      error: null,
    });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await post("/api/pins", { kind: "clip", clipId: "c1", label: "Linear" });

    expect(res.status).toBe(201);
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "clip", clip_id: "c1", label: "Linear" }),
    );
  });

  it("creates a view pin with a sanitized query", async () => {
    const chain = mockChain({
      data: {
        id: "p2",
        user_id: "test-user-id",
        kind: "view",
        layout: "panel",
        position: 1,
        view_query: { semantic: "design", limit: 12 },
        pinned_at: "t",
        updated_at: "t",
      },
      error: null,
    });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await post("/api/pins", {
      kind: "view",
      layout: "panel",
      viewQuery: { semantic: "design", evil: "DROP TABLE" },
    });

    expect(res.status).toBe(201);
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ view_query: { semantic: "design", limit: 12 } }),
    );
  });

  it("rejects a clip pin with no clipId", async () => {
    supabaseMock = { from: vi.fn().mockReturnValue(mockChain({ data: null, error: null })) };
    const res = await post("/api/pins", { kind: "clip" });
    expect(res.status).toBe(400);
  });

  it("rejects a view pin with no viewQuery", async () => {
    supabaseMock = { from: vi.fn().mockReturnValue(mockChain({ data: null, error: null })) };
    const res = await post("/api/pins", { kind: "view" });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown kind", async () => {
    supabaseMock = { from: vi.fn().mockReturnValue(mockChain({ data: null, error: null })) };
    const res = await post("/api/pins", { kind: "connector", connector: "github" });
    expect(res.status).toBe(400);
  });

  it("reorders pins into a dense sequence", async () => {
    const chain = mockChain({ data: [], error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await post("/api/pins/reorder", { ids: ["p3", "p1", "p2"] });

    expect(res.status).toBe(200);
    expect(chain.update).toHaveBeenCalledTimes(3);
    expect(chain.update).toHaveBeenNthCalledWith(1, { position: 0 });
    expect(chain.update).toHaveBeenNthCalledWith(2, { position: 1 });
    expect(chain.update).toHaveBeenNthCalledWith(3, { position: 2 });
  });

  it("resolves items for a view pin", async () => {
    const chain = mockChain({
      data: {
        id: "p2",
        user_id: "test-user-id",
        kind: "view",
        layout: "panel",
        position: 0,
        view_query: { semantic: "design", limit: 12 },
        pinned_at: "t",
        updated_at: "t",
      },
      error: null,
    });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/pins/p2/items");

    expect(res.status).toBe(200);
    expect(runViewQuery).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ semantic: "design" }),
    );
  });

  it("refuses to resolve items for a clip pin", async () => {
    const chain = mockChain({
      data: {
        id: "p1",
        user_id: "test-user-id",
        kind: "clip",
        layout: "tile",
        position: 0,
        clip_id: "c1",
        pinned_at: "t",
        updated_at: "t",
      },
      error: null,
    });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/pins/p1/items");

    expect(res.status).toBe(400);
  });

  it("resolves the target url for a clip pin, so tiles are clickable", async () => {
    // Bookmarks are metadata-tier and excluded from the inbox, so the client
    // can never learn their URL from panel data — the join has to supply it.
    const chain = mockChain({
      data: [
        {
          id: "p1",
          user_id: "test-user-id",
          kind: "clip",
          layout: "tile",
          position: 0,
          clip_id: "c1",
          pinned_at: "t",
          updated_at: "t",
          clip: { source_url: "https://linear.app", video_url: null, video_title: "Linear" },
        },
      ],
      error: null,
    });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/pins");
    const body = (await res.json()) as { pins: { clipUrl?: string; clipTitle?: string }[] };

    expect(chain.select).toHaveBeenCalledWith(expect.stringContaining("clips("));
    expect(body.pins[0].clipUrl).toBe("https://linear.app");
    expect(body.pins[0].clipTitle).toBe("Linear");
  });

  it("falls back to video_url when a pinned clip has no source_url", async () => {
    const chain = mockChain({
      data: [
        {
          id: "p1",
          user_id: "test-user-id",
          kind: "clip",
          layout: "tile",
          position: 0,
          clip_id: "c1",
          pinned_at: "t",
          updated_at: "t",
          clip: { source_url: null, video_url: "https://youtu.be/abc", video_title: "Vid" },
        },
      ],
      error: null,
    });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/pins");
    const body = (await res.json()) as { pins: { clipUrl?: string }[] };
    expect(body.pins[0].clipUrl).toBe("https://youtu.be/abc");
  });

  it("deletes a pin", async () => {
    const chain = mockChain({ data: null, error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/pins/p1", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("user_id", "test-user-id");
  });
});
