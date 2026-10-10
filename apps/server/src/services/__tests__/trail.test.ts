import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

function chain(result: Record<string, unknown> = {}) {
  const c: Record<string, unknown> = {};
  for (const m of [
    "select",
    "eq",
    "is",
    "in",
    "not",
    "lt",
    "or",
    "order",
    "limit",
    "insert",
    "update",
    "delete",
    "upsert",
    "maybeSingle",
  ]) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  (c as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(result);
  return c;
}

let tables: Record<string, ReturnType<typeof chain>[]> = {};
vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: (t: string) => tables[t]?.shift() ?? chain() },
}));
const tagClipMock = vi.fn();
vi.mock("../tagger.js", async (orig) => ({
  ...(await orig<typeof import("../tagger.js")>()),
  tagClip: (...a: unknown[]) => tagClipMock(...a),
  isTaggerConfigured: () => true,
}));

const { captureTrail, listTrail, purgeExpiredTrail } = await import("../trail.js");

const T0 = Date.parse("2026-10-10T10:00:00Z");

describe("trail service", () => {
  beforeEach(() => {
    layer("unit");
    epic("Trail");
    feature("Capture and list");
    vi.clearAllMocks();
    tagClipMock.mockResolvedValue({ apply: [], suggest: [] });
  });

  it("captures new pages with keyword + Jev tags, one row per URL (latest close wins)", async () => {
    const insert = chain({ error: null });
    tables = {
      clips: [chain({ data: [] }), chain({ data: [{ tags: ["design"] }] })],
      trail_items: [chain({ data: [] }), insert],
      tag_hints: [chain({ data: [{ tag: "project:lotus-bech", keywords: ["we curate life"] }] })],
    };
    tagClipMock.mockResolvedValue({ apply: ["design"], suggest: [] });

    const saved = await captureTrail("u1", [
      { url: "https://wecuratelife-mockups.vercel.app/c", title: "old", closedAt: T0 },
      {
        url: "https://wecuratelife-mockups.vercel.app/c",
        title: "Refined Living",
        closedAt: T0 + 5000,
      },
    ]);

    expect(saved).toBe(1);
    const rows = (insert.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(rows).toEqual([
      expect.objectContaining({
        url: "https://wecuratelife-mockups.vercel.app/c",
        title: "Refined Living",
        host: "wecuratelife-mockups.vercel.app",
        tags: ["project:lotus-bech", "design"],
        closed_at: new Date(T0 + 5000).toISOString(),
      }),
    ]);
  });

  it("skips pages already saved as clips and bumps pages already in the trail", async () => {
    const update = chain({ error: null });
    tables = {
      clips: [chain({ data: [{ source_url: "https://saved.com" }] })],
      trail_items: [
        chain({ data: [{ id: "t1", url: "https://seen.com", close_count: 2 }] }),
        update,
      ],
    };
    const saved = await captureTrail("u1", [
      { url: "https://saved.com", title: "Saved", closedAt: T0 },
      { url: "https://seen.com", title: "Seen again", closedAt: T0 },
    ]);
    expect(saved).toBe(1);
    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Seen again", close_count: 3 }),
    );
    expect(tagClipMock).not.toHaveBeenCalled(); // no fresh rows → no tagging
  });

  it("still saves (untagged) when Jev fails", async () => {
    const insert = chain({ error: null });
    tables = {
      clips: [chain({ data: [] }), chain({ data: [{ tags: ["design"] }] })],
      trail_items: [chain({ data: [] }), insert],
      tag_hints: [chain({ data: [] })],
    };
    tagClipMock.mockRejectedValue(new Error("503"));
    expect(await captureTrail("u1", [{ url: "https://x.com", title: "X", closedAt: T0 }])).toBe(1);
    expect((insert.insert as ReturnType<typeof vi.fn>).mock.calls[0][0][0].tags).toEqual([]);
  });

  it("lists newest first, pages with nextBefore, and sanitizes search for PostgREST", async () => {
    const rows = [0, 1, 2].map((i) => ({
      id: `t${i}`,
      url: `https://x.com/${i}`,
      title: `T${i}`,
      host: "x.com",
      tags: [],
      closed_at: new Date(T0 - i * 1000).toISOString(),
      close_count: 1,
    }));
    const q = chain({ data: rows });
    tables = { trail_items: [q] };

    const r = await listTrail("u1", { q: "lotus, (bech)%", limit: 2 });

    expect(r.items.map((i) => i.id)).toEqual(["t0", "t1"]);
    expect(r.nextBefore).toBe(rows[1].closed_at);
    const filter = (q.or as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(filter).not.toMatch(/[()%]bech|,\s*\(/); // no injected filter syntax
    expect(filter).toContain("title.ilike.%lotus   bech%");
  });

  it("purges only for users who set a retention", async () => {
    const del = chain({ data: [{ id: "a" }, { id: "b" }] });
    tables = {
      user_settings: [chain({ data: [{ user_id: "u1", trail_retention_days: 30 }] })],
      trail_items: [del],
    };
    expect(await purgeExpiredTrail(T0)).toBe(2);
    expect(del.lt).toHaveBeenCalledWith("closed_at", new Date(T0 - 30 * 86_400_000).toISOString());
  });
});
