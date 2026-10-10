import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

function chain(result: Record<string, unknown> = {}) {
  const c: Record<string, unknown> = {};
  for (const m of [
    "select",
    "eq",
    "is",
    "in",
    "or",
    "limit",
    "insert",
    "delete",
    "maybeSingle",
    "single",
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
vi.mock("../../lib/inngest.js", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../extractors/webMetadata.js", () => ({
  extractWebMetadata: vi.fn().mockResolvedValue({ title: "Lotus Bech – Drive", siteName: "Drive" }),
}));
const tagsForPages = vi.fn().mockResolvedValue(new Map());
vi.mock("../page-tags.js", async (orig) => ({
  ...(await orig<typeof import("../page-tags.js")>()),
  tagsForPages: (...a: unknown[]) => tagsForPages(...a),
}));

const { pinPage } = await import("../pin-page.js");

const URL = "https://drive.google.com/drive/folders/18y";
const clipRow = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  source_url: URL,
  source_type: "web",
  status: "completed",
  tags: [],
  created_at: "t",
  updated_at: "t",
  ...over,
});
const pinRow = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  user_id: "u1",
  kind: "clip",
  layout: "tile",
  position: 0,
  clip_id: "c1",
  pinned_at: "t",
  updated_at: "t",
  ...over,
});

describe("pinPage", () => {
  beforeEach(() => {
    layer("unit");
    epic("Tabs view");
    feature("Pins");
    tables = {};
    tagsForPages.mockResolvedValue(new Map());
  });

  it("creates a bookmark-tier clip with the page's tag and your name/note, drops the trail row, pins it", async () => {
    tagsForPages.mockResolvedValue(new Map([[URL, "freelance:lotus-bech"]]));
    const insertClip = chain({ data: clipRow({ tags: ["freelance:lotus-bech"] }), error: null });
    const trailDelete = chain({ error: null });
    const insertPin = chain({ data: pinRow(), error: null });
    tables = {
      clips: [chain({ data: [] }), insertClip],
      trail_items: [trailDelete],
      pinned_items: [chain({ data: null }), insertPin],
    };

    const r = await pinPage({ userId: "u1", url: URL, title: "Mine", note: "waiting" });

    expect(insertClip.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        enrichment_tier: "metadata",
        source_url: URL,
        video_title: "Mine",
        user_notes: "waiting",
        tags: ["freelance:lotus-bech"],
        status: "completed",
      }),
    );
    expect(trailDelete.delete).toHaveBeenCalled();
    expect(trailDelete.in).toHaveBeenCalledWith("url", expect.arrayContaining([URL]));
    expect(insertPin.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "clip", clip_id: "c1", user_id: "u1" }),
    );
    expect(r).toMatchObject({ created: true, clip: { id: "c1" }, pin: { id: "p1" } });
  });

  it("reuses an existing clip (any tier) and an existing pin — idempotent", async () => {
    const insertClip = chain();
    const insertPin = chain();
    tables = {
      clips: [
        chain({ data: [clipRow({ id: "c9", enrichment_tier: "full", tags: ["design"] })] }),
        insertClip,
      ],
      trail_items: [chain({ error: null })],
      pinned_items: [chain({ data: pinRow({ id: "p9", clip_id: "c9" }) }), insertPin],
    };
    const r = await pinPage({ userId: "u1", url: URL });
    expect(r).toMatchObject({
      created: false,
      clip: { id: "c9", tags: ["design"] },
      pin: { id: "p9" },
    });
    expect(insertClip.insert).not.toHaveBeenCalled();
    expect(insertPin.insert).not.toHaveBeenCalled();
  });

  it("reuses the summarized clip for a YouTube page (matched by video id, not source_url)", async () => {
    const lookup = chain({
      data: [clipRow({ id: "v1", source_url: null, youtube_video_id: "dQw4w9WgXcQ" })],
    });
    const insertClip = chain();
    tables = {
      clips: [lookup, insertClip],
      trail_items: [chain({ error: null })],
      pinned_items: [
        chain({ data: null }),
        chain({ data: pinRow({ clip_id: "v1" }), error: null }),
      ],
    };
    const r = await pinPage({
      userId: "u1",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42",
    });
    expect(lookup.or).toHaveBeenCalledWith(
      expect.stringContaining("youtube_video_id.eq.dQw4w9WgXcQ"),
    );
    expect(insertClip.insert).not.toHaveBeenCalled();
    expect(r).toMatchObject({ clip: { id: "v1" } });
  });

  it("removes the trail row whether it holds the raw or the normalized url", async () => {
    const raw = "https://www.nytimes.com/x/";
    const trailDelete = chain({ error: null });
    tables = {
      clips: [chain({ data: [clipRow({ source_url: raw })] })],
      trail_items: [trailDelete],
      pinned_items: [chain({ data: pinRow() })],
    };
    await pinPage({ userId: "u1", url: raw });
    expect(trailDelete.in).toHaveBeenCalledWith(
      "url",
      expect.arrayContaining([raw, "https://nytimes.com/x"]),
    );
  });

  it("falls back to the url as title when metadata fails and no title is given", async () => {
    const { extractWebMetadata } = await import("../extractors/webMetadata.js");
    vi.mocked(extractWebMetadata).mockRejectedValueOnce(new Error("timeout"));
    const insertClip = chain({ data: clipRow(), error: null });
    tables = {
      clips: [chain({ data: [] }), insertClip],
      trail_items: [chain({ error: null })],
      pinned_items: [chain({ data: null }), chain({ data: pinRow(), error: null })],
    };
    await pinPage({ userId: "u1", url: URL });
    expect(insertClip.insert).toHaveBeenCalledWith(expect.objectContaining({ video_title: URL }));
  });
});
