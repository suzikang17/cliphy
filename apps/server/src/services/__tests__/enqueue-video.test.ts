import { describe, it, expect, vi, beforeEach } from "vitest";

// Saving a YouTube link takes one trip to the database, since the person
// sharing the link waits on it. What that one call decides is tested against
// real SQL in enqueue-video.sql.test.ts.

const rpc = vi.fn();
const from = vi.fn();
const send = vi.fn();
vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("../../lib/inngest.js", () => ({ inngest: { send: (...a: unknown[]) => send(...a) } }));

const { enqueueVideo } = await import("../enqueue-video.js");

const URL = "https://www.youtube.com/watch?v=GLvFTMtw4Jk";
const row = { id: "clip-1", video_title: null, created_at: "2026-11-23T10:00:00Z" };

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: { outcome: "ok", row, position: 1 } });
  from.mockReset();
  send.mockReset().mockResolvedValue(undefined);
});

describe("enqueueVideo", () => {
  it("saves a shared link with one database call and one event", async () => {
    const result = await enqueueVideo({ userId: "u1", videoUrl: URL });
    expect(result).toMatchObject({ ok: true, row, position: 1 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "enqueue_video",
      expect.objectContaining({
        p_user_id: "u1",
        p_video_id: "GLvFTMtw4Jk",
        p_want_position: false,
      }),
    );
    expect(from).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ id: "summarize-clip-1", name: "video/summarize.requested" }),
    );
  });

  it("asks for the queue position only for the caller that shows it", async () => {
    await enqueueVideo({ userId: "u1", videoUrl: URL, wantPosition: true });
    expect(rpc).toHaveBeenCalledWith(
      "enqueue_video",
      expect.objectContaining({ p_want_position: true }),
    );
  });

  it("turns a duplicate, a used-up month and a failure into their answers, starting no summary", async () => {
    rpc.mockResolvedValueOnce({ data: { outcome: "duplicate" } });
    expect(await enqueueVideo({ userId: "u1", videoUrl: URL })).toMatchObject({ status: 409 });
    rpc.mockResolvedValueOnce({ data: { outcome: "limited", limit: 5, plan: "free" } });
    expect(await enqueueVideo({ userId: "u1", videoUrl: URL })).toMatchObject({
      status: 429,
      body: { code: "RATE_LIMITED", limit: 5, plan: "free" },
    });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await enqueueVideo({ userId: "u1", videoUrl: URL })).toMatchObject({ status: 500 });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a link that is not a YouTube video before asking the database", async () => {
    expect(await enqueueVideo({ userId: "u1", videoUrl: "https://vimeo.com/1" })).toMatchObject({
      status: 400,
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
