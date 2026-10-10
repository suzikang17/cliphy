import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

function chain(result: Record<string, unknown> = {}) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "insert", "maybeSingle", "single"]) {
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
const enqueueMock = vi.fn();
vi.mock("../enqueue-video.js", () => ({ enqueueVideo: (...a: unknown[]) => enqueueMock(...a) }));
const enrichMock = vi.fn();
vi.mock("../enrich.js", () => ({ enrichClip: (...a: unknown[]) => enrichMock(...a) }));
const tagClipMock = vi.fn();
let configured = true;
vi.mock("../tagger.js", async (orig) => ({
  ...(await orig<typeof import("../tagger.js")>()),
  tagClip: (...a: unknown[]) => tagClipMock(...a),
  isTaggerConfigured: () => configured,
}));

const { quickSave } = await import("../quick-save.js");

const page = {
  userId: "u1",
  url: "https://wecuratelife-mockups.vercel.app/c",
  title: "Refined Living",
  text: "Mockups for the We Curate Life interior design site",
};

function setup({
  existing = null as Record<string, unknown> | null,
  clipTags = [] as { tags: string[] }[],
  hints = [] as { tag: string; keywords: string[] }[],
} = {}) {
  const insert = chain({ data: { id: "c1", tags: [], status: "completed" }, error: null });
  tables = {
    clips: [chain({ data: existing }), chain({ data: clipTags }), insert],
    tag_hints: [chain({ data: hints })],
  };
  return insert;
}

describe("quickSave", () => {
  beforeEach(() => {
    layer("unit");
    epic("Capture");
    feature("Quick save (⌘⇧S)");
    vi.clearAllMocks();
    configured = true;
  });

  it("sends YouTube videos to the summarize queue", async () => {
    enqueueMock.mockResolvedValue({ ok: true, row: { id: "v1" }, position: 1 });
    const r = await quickSave({ ...page, url: "https://www.youtube.com/watch?v=abc123def45" });
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        videoUrl: "https://www.youtube.com/watch?v=abc123def45",
      }),
    );
    expect(r).toMatchObject({ ok: true, video: true, tags: [] });
  });

  it("returns the existing clip for a page already saved", async () => {
    setup({ existing: { id: "old", tags: ["design"], suggested_tags: [] } });
    const r = await quickSave(page);
    expect(r).toMatchObject({ ok: true, duplicate: true, tags: ["design"] });
    expect(tagClipMock).not.toHaveBeenCalled();
  });

  it("applies keyword tags and Jev tags together, no Claude call", async () => {
    const insert = setup({
      clipTags: [{ tags: ["design"] }, { tags: ["cooking"] }],
      hints: [{ tag: "project:lotus-bech", keywords: ["we curate life"] }],
    });
    tagClipMock.mockResolvedValue({ apply: ["design"], suggest: [] });

    const r = await quickSave(page);

    expect(r).toMatchObject({
      ok: true,
      tags: ["project:lotus-bech", "design"],
      suggestedTags: [],
    });
    expect(enrichMock).not.toHaveBeenCalled();
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_url: page.url,
        video_title: "Refined Living",
        content: page.text,
        tags: ["project:lotus-bech", "design"],
        suggested_tags: [],
      }),
    );
    // Hint-only tags are part of the vocabulary Jev chooses from.
    expect(tagClipMock.mock.calls[0][0].existingTags).toEqual(
      expect.arrayContaining(["design", "cooking", "project:lotus-bech"]),
    );
  });

  it("asks Claude only when nothing fits: known tags apply, new ones become suggestions", async () => {
    const insert = setup({ clipTags: [{ tags: ["design"] }] });
    tagClipMock.mockResolvedValue({ apply: [], suggest: [] });
    enrichMock.mockResolvedValue({
      summary: "s",
      tags: ["design", "interiors"],
      category: "design",
    });

    const r = await quickSave({ ...page, url: "https://other.com/x", title: "Moodboard" });

    expect(r).toMatchObject({ ok: true, tags: ["design"], suggestedTags: ["interiors"] });
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ category: "design", suggested_tags: ["interiors"] }),
    );
  });

  it("still saves when Jev and Claude both fail", async () => {
    setup({ clipTags: [{ tags: ["design"] }] });
    tagClipMock.mockRejectedValue(new Error("503"));
    enrichMock.mockRejectedValue(new Error("credit balance"));
    const r = await quickSave({ ...page, url: "https://other.com/y" });
    expect(r).toMatchObject({ ok: true, tags: [], suggestedTags: [] });
  });

  it("skips Jev when it isn't configured but keywords still apply", async () => {
    configured = false;
    setup({ hints: [{ tag: "project:lotus-bech", keywords: ["we curate life"] }] });
    const r = await quickSave(page);
    expect(tagClipMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, tags: ["project:lotus-bech"] });
  });

  it("saves your note as the clip's notes", async () => {
    const insert = setup({});
    tagClipMock.mockResolvedValue({ apply: [], suggest: [] });
    enrichMock.mockResolvedValue({ summary: "s", tags: [], category: "reading" });
    await quickSave({ ...page, url: "https://n.com", note: "follow up Friday" });
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_notes: "follow up Friday" }),
    );
  });
});
