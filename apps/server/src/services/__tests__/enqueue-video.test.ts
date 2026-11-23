import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeDb, type FakeDb, type Op } from "../../routes/coach/__tests__/helpers.js";

// Saving a YouTube link: how many trips to the database it takes, since the
// person sharing the link waits on every one of them.

let db: FakeDb;
const rpc = vi.fn();
const send = vi.fn();
vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: (t: string) => db.from(t), rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("../../lib/inngest.js", () => ({ inngest: { send: (...a: unknown[]) => send(...a) } }));

const { enqueueVideo } = await import("../enqueue-video.js");

const URL = "https://www.youtube.com/watch?v=GLvFTMtw4Jk";
const row = { id: "clip-1", video_title: null, created_at: "2026-11-23T10:00:00Z" };

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: true });
  send.mockReset().mockResolvedValue(undefined);
  db = makeDb((op: Op) => {
    if (op.table === "clips" && op.action === "insert") return { data: row };
    if (op.table === "clips" && op.single) return { data: null }; // not queued already
    if (op.table === "users") return { data: { plan: "pro", monthly_limit_bonus: 0 } };
    if (op.table === "user_settings") return { data: { summary_language: "en" } };
    return { data: [] };
  });
});

describe("enqueueVideo", () => {
  it("saves a shared link without counting the queue ahead of it", async () => {
    const result = await enqueueVideo({ userId: "u1", videoUrl: URL });
    expect(result.ok).toBe(true);
    // Three reads asked together, then the insert. No position count.
    expect(db.ops.map((o) => `${o.table}:${o.action}`)).toEqual([
      "clips:select",
      "users:select",
      "user_settings:select",
      "clips:insert",
    ]);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ id: "summarize-clip-1", name: "video/summarize.requested" }),
    );
  });

  it("counts the queue ahead only for the caller that shows a position", async () => {
    const result = await enqueueVideo({ userId: "u1", videoUrl: URL, wantPosition: true });
    expect(result).toMatchObject({ ok: true, position: 1 });
    expect(db.ops).toHaveLength(5);
  });

  it("still refuses a video queued moments ago, before touching the monthly count", async () => {
    db = makeDb((op: Op) => (op.table === "clips" ? { data: { id: "x", status: "pending" } } : {}));
    const result = await enqueueVideo({ userId: "u1", videoUrl: URL });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(rpc).not.toHaveBeenCalled();
  });
});
