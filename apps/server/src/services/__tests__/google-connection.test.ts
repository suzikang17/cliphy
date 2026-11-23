import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeDb, eqValue, type FakeDb, type Op } from "../../routes/coach/__tests__/helpers.js";

// What happens to the liked-videos pull when the Google connection dies, has a
// passing failure, or is made again.

let db: FakeDb;
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));

const fetchLikedVideos = vi.fn();
vi.mock("../youtube.js", () => ({
  fetchChannelVideos: vi.fn().mockResolvedValue([]),
  fetchLikedVideos: (...a: unknown[]) => fetchLikedVideos(...a),
  fetchMyPlaylists: vi.fn().mockResolvedValue([]),
  fetchPlaylistVideos: vi.fn().mockResolvedValue([]),
}));

const { refreshGoogleTokenIfNeeded, resumeGoogleSubscriptions, pollAndQueueSubscription } =
  await import("../subscriptions.js");

const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const expiredToken = { access_token: "old", refresh_token: "r", expires_at: PAST };
const google = (status: number, body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body }),
  );

beforeEach(() => {
  fetchLikedVideos.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("refreshing the Google token", () => {
  it("drops a connection Google no longer honours, and pauses what needs it", async () => {
    db = makeDb((op: Op) =>
      op.table === "user_google_tokens" && op.action === "select"
        ? { data: expiredToken }
        : undefined,
    );
    google(400, { error: "invalid_grant" });

    expect(await refreshGoogleTokenIfNeeded("u1")).toBeNull();

    const dropped = db.ops.find((o) => o.table === "user_google_tokens" && o.action === "delete");
    expect(dropped && eqValue(dropped, "user_id")).toBe("u1");
    const paused = db.ops.find((o) => o.table === "subscriptions" && o.action === "update");
    expect(paused?.payload).toEqual({ is_active: false });
    expect(paused?.filters).toContainEqual(["in", "type", ["watch_later", "liked"]]);
  });

  it("keeps the connection through a passing failure", async () => {
    db = makeDb((op: Op) =>
      op.table === "user_google_tokens" && op.action === "select"
        ? { data: expiredToken }
        : undefined,
    );
    google(503, { error: "backend_error" });

    expect(await refreshGoogleTokenIfNeeded("u1")).toBeNull();
    expect(db.writtenTables()).toEqual([]);
  });

  it("stores and returns the new token when Google gives one", async () => {
    db = makeDb((op: Op) =>
      op.table === "user_google_tokens" && op.action === "select"
        ? { data: expiredToken }
        : undefined,
    );
    google(200, { access_token: "fresh", expires_in: 3600 });

    expect(await refreshGoogleTokenIfNeeded("u1")).toBe("fresh");
    expect(db.written("user_google_tokens", "update")).toEqual([
      expect.objectContaining({ access_token: "fresh" }),
    ]);
  });
});

describe("polling liked videos with no usable token", () => {
  it("leaves the pull switched on when Google was only briefly unreachable", async () => {
    db = makeDb((op: Op) => {
      if (op.table === "subscriptions" && op.action === "select") {
        return { data: { id: "s1", user_id: "u1", type: "liked", is_active: true, users: {} } };
      }
      if (op.table === "user_google_tokens" && op.action === "select") {
        return { data: expiredToken };
      }
      return undefined;
    });
    google(503, { error: "backend_error" });

    await pollAndQueueSubscription("s1");

    expect(db.writtenTables()).toEqual([]);
    expect(fetchLikedVideos).not.toHaveBeenCalled();
  });
});

describe("connecting Google again", () => {
  const pausedLiked = (seen: string[]) =>
    makeDb((op: Op) => {
      if (op.table === "subscriptions" && op.action === "select") return { data: [{ id: "s1" }] };
      if (op.table === "subscription_seen_videos" && op.action === "select") {
        return { data: seen.map((youtube_video_id) => ({ youtube_video_id })) };
      }
      return undefined;
    });

  it("switches liked videos back on, counting likes made meanwhile as already seen", async () => {
    db = pausedLiked(["a"]);
    fetchLikedVideos.mockResolvedValue([{ videoId: "a" }, { videoId: "b" }, { videoId: "c" }]);

    expect(await resumeGoogleSubscriptions("u1", "tok")).toBe(1);

    expect(db.written("subscription_seen_videos", "insert")).toEqual([
      [
        { subscription_id: "s1", youtube_video_id: "b" },
        { subscription_id: "s1", youtube_video_id: "c" },
      ],
    ]);
    expect(db.written("subscriptions", "update")).toEqual([{ is_active: true }]);
    const lookup = db.ops.find((o) => o.table === "subscriptions" && o.action === "select");
    expect(lookup?.filters).toEqual([
      ["eq", "user_id", "u1"],
      ["eq", "type", "liked"],
      ["eq", "is_active", false],
    ]);
  });

  it("leaves it off when the likes cannot be read, so old likes are not all queued", async () => {
    db = pausedLiked([]);
    fetchLikedVideos.mockRejectedValue(new Error("YouTube API error: 403"));

    expect(await resumeGoogleSubscriptions("u1", "tok")).toBe(0);
    expect(db.writtenTables()).toEqual([]);
  });

  it("does nothing, and asks YouTube nothing, when no pull was paused", async () => {
    db = makeDb(() => ({ data: [] }));

    expect(await resumeGoogleSubscriptions("u1", "tok")).toBe(0);
    expect(fetchLikedVideos).not.toHaveBeenCalled();
  });
});
