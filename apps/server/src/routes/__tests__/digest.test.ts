import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { makeDb, passAuth, eqValue, type FakeDb, type Op } from "../coach/__tests__/helpers.js";

// Reading the weekly digest, keeping a video from it, and dismissing one.

let db: FakeDb;
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../middleware/auth.js", () => passAuth);
const enqueueVideo = vi.fn();
vi.mock("../../services/enqueue-video.js", () => ({
  enqueueVideo: (...a: unknown[]) => enqueueVideo(...a),
}));

const { digestRoutes } = await import("../digest.js");
const app = () => new Hono().route("/digest", digestRoutes);
const post = (path: string) => app().request(path, { method: "POST" });

const row = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  youtube_video_id: "vid1",
  video_title: "A new upload",
  video_channel: "Chan",
  published_at: "2026-11-20T10:00:00Z",
  score: 0.8,
  because_clip_id: "clip-9",
  summary_json: { summary: "tl;dr", keyPoints: ["one"], timestamps: [] },
  kept_clip_id: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /digest", () => {
  it("returns the newest digest's videos, with the clip each is closest to", async () => {
    db = makeDb((op: Op) => {
      if (op.table === "user_settings") return { data: { weekly_digest: true } };
      if (op.table === "clips")
        return { data: [{ id: "clip-9", video_title: "Dialing in espresso" }] };
      if (op.single) return { data: { digest_date: "2026-11-22" } };
      return { data: [row()] };
    });

    const res = await app().request("/digest");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: true,
      digestDate: "2026-11-22",
      items: [
        {
          id: "d1",
          videoId: "vid1",
          videoUrl: "https://www.youtube.com/watch?v=vid1",
          title: "A new upload",
          channel: "Chan",
          publishedAt: "2026-11-20T10:00:00Z",
          summaryJson: { summary: "tl;dr", keyPoints: ["one"], timestamps: [] },
          becauseTitle: "Dialing in espresso",
          keptClipId: null,
        },
      ],
    });
    const list = db.ops.find((o) => o.table === "digest_items" && !o.single);
    expect(list?.filters).toEqual([
      ["eq", "user_id", "test-user-id"],
      ["eq", "digest_date", "2026-11-22"],
      ["is", "dismissed_at", null],
    ]);
  });

  it("says so when no digest has been made yet", async () => {
    db = makeDb(() => ({ data: null }));
    const res = await app().request("/digest");
    expect(await res.json()).toEqual({ enabled: false, digestDate: null, items: [] });
  });
});

describe("POST /digest/:id/keep", () => {
  it("saves the video through the normal queue and remembers the clip", async () => {
    db = makeDb((op: Op) => (op.action === "select" ? { data: row() } : { data: null }));
    enqueueVideo.mockResolvedValue({ ok: true, row: { id: "clip-new" }, position: 0 });

    const res = await post("/digest/d1/keep");

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ clipId: "clip-new" });
    expect(enqueueVideo).toHaveBeenCalledWith({
      userId: "test-user-id",
      videoUrl: "https://www.youtube.com/watch?v=vid1",
      videoTitle: "A new upload",
      videoChannel: "Chan",
    });
    expect(db.written("digest_items", "update")).toEqual([{ kept_clip_id: "clip-new" }]);
    expect(eqValue(db.ops[0], "user_id")).toBe("test-user-id");
  });

  it("answers with the same clip when it was already kept", async () => {
    db = makeDb(() => ({ data: row({ kept_clip_id: "clip-old" }) }));
    const res = await post("/digest/d1/keep");
    expect(await res.json()).toEqual({ clipId: "clip-old" });
    expect(enqueueVideo).not.toHaveBeenCalled();
  });

  it("passes on the queue's refusal, such as the monthly limit", async () => {
    db = makeDb(() => ({ data: row() }));
    enqueueVideo.mockResolvedValue({
      ok: false,
      status: 429,
      body: { error: "Monthly summary limit reached", code: "RATE_LIMITED" },
    });

    const res = await post("/digest/d1/keep");

    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(db.writtenTables()).toEqual([]);
  });

  it("refuses a video that is not in this person's digest", async () => {
    db = makeDb(() => ({ data: null }));
    expect((await post("/digest/nope/keep")).status).toBe(404);
    expect(enqueueVideo).not.toHaveBeenCalled();
  });
});

describe("POST /digest/:id/dismiss", () => {
  it("marks the video dismissed, for this person only", async () => {
    db = makeDb(() => ({ data: { id: "d1" } }));

    const res = await post("/digest/d1/dismiss");

    expect(await res.json()).toEqual({ dismissed: true });
    const op = db.ops[0];
    expect(op.action).toBe("update");
    expect(op.payload).toEqual({ dismissed_at: expect.any(String) });
    expect(op.filters).toEqual([
      ["eq", "id", "d1"],
      ["eq", "user_id", "test-user-id"],
    ]);
  });

  it("refuses one that is not theirs", async () => {
    db = makeDb(() => ({ data: null }));
    expect((await post("/digest/d1/dismiss")).status).toBe(404);
  });
});
