import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { makeDb, type FakeDb, type Op } from "../../routes/coach/__tests__/helpers.js";

// The background half of saving an article or a post: the bare link is
// already stored; this reads the page and fills the clip in.

let db: FakeDb;
let clip: Record<string, unknown> | null;
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
const send = vi.fn();
type Handler = (ctx: unknown) => Promise<unknown>;
let onFailure: Handler;
vi.mock("../../lib/inngest.js", () => ({
  inngest: {
    createFunction: (config: { onFailure: Handler }, fn: Handler) => {
      onFailure = config.onFailure;
      return fn;
    },
    send: (...a: unknown[]) => send(...a),
  },
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
const extractWebClip = vi.fn();
const extractTweetClip = vi.fn();
vi.mock("../../services/extractors/web.js", () => ({
  extractWebClip: (...a: unknown[]) => extractWebClip(...a),
}));
vi.mock("../../services/extractors/tweet.js", () => ({
  extractTweetClip: (...a: unknown[]) => extractTweetClip(...a),
}));

const { extractClip } = await import("../extract-clip.js");
const run = (clipId = "c1") =>
  (extractClip as unknown as Handler)({
    event: { data: { clipId } },
    step: { run: async (_name: string, fn: () => Promise<unknown>) => fn() },
  });
const updates = () => db.ops.filter((o) => o.action === "update");

beforeEach(() => {
  layer("unit");
  epic("Ingest");
  feature("Extract Worker");
  vi.clearAllMocks();
  clip = {
    id: "c1",
    source_type: "web",
    source_url: "https://example.com/post",
    status: "processing",
  };
  db = makeDb((op: Op) => (op.action === "select" ? { data: clip } : { data: null }));
  extractWebClip.mockResolvedValue({
    kind: "article",
    title: "A real title",
    siteName: "Example",
    heroImageUrl: "https://example.com/hero.jpg",
    excerpt: "Opening words",
    content: "The whole article.",
    readingTimeMin: 3,
  });
  extractTweetClip.mockResolvedValue({
    text: "A long post, in full.",
    author: { name: "Pat", handle: "pat", avatarUrl: "https://pbs.test/pat.jpg" },
    media: [],
    quotedTweet: null,
    threadTweetIds: ["111", "112"],
    threadTruncated: false,
    heroImageUrl: undefined,
  });
});

describe("extract-clip", () => {
  it("reads an article, fills the clip in, and asks for its summary and tags", async () => {
    expect(await run()).toEqual({ clipId: "c1", status: "completed" });
    expect(extractWebClip).toHaveBeenCalledWith("https://example.com/post");
    const [write] = updates();
    expect(write.payload).toMatchObject({
      status: "completed",
      video_title: "A real title",
      content: "The whole article.",
      excerpt: "Opening words",
      hero_image_url: "https://example.com/hero.jpg",
      source_metadata: { siteName: "Example", readingTimeMin: 3, kind: "article" },
    });
    // Only a clip still waiting is written, so a late retry cannot undo an edit.
    expect(write.filters).toContainEqual(["eq", "status", "processing"]);
    expect(send).toHaveBeenCalledWith({ name: "clip/embed.requested", data: { clipId: "c1" } });
  });

  it("reads a post with its author and thread", async () => {
    clip = { ...clip, source_type: "tweet", source_url: "https://x.com/pat/status/111" };
    await run();
    expect(updates()[0].payload).toMatchObject({
      status: "completed",
      video_title: "Pat (@pat)",
      author: "pat",
      content: "A long post, in full.",
      source_metadata: { handle: "pat", threadTweetIds: ["111", "112"], threadTruncated: false },
    });
  });

  it("leaves a clip alone that is no longer waiting", async () => {
    clip = { ...clip, status: "completed" };
    expect(await run()).toEqual({ clipId: "c1", status: "skipped" });
    expect(extractWebClip).not.toHaveBeenCalled();
    expect(updates()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("throws when the page cannot be read, so the job is tried again", async () => {
    extractWebClip.mockRejectedValue(new Error("fetch failed: 503"));
    await expect(run()).rejects.toThrow("503");
    expect(updates()).toEqual([]);
  });

  it("marks the clip failed, with the reason, once every try has failed", async () => {
    await onFailure({
      event: {
        data: { event: { data: { clipId: "c1" } }, error: { message: "fetch failed: 503" } },
      },
    });
    const [write] = updates();
    expect(write.payload).toEqual({ status: "failed", error_message: "fetch failed: 503" });
    expect(write.filters).toContainEqual(["eq", "id", "c1"]);
  });
});
