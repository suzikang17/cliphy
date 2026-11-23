import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeDb, type FakeDb, type Op } from "../../routes/coach/__tests__/helpers.js";

// Building one person's weekly digest: the closest new uploads, summarized.

let db: FakeDb;
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
const send = vi.fn();
type Handler = (ctx: unknown) => Promise<unknown>;
vi.mock("../../lib/inngest.js", () => ({
  inngest: {
    createFunction: (_config: unknown, fn: Handler) => fn,
    send: (...a: unknown[]) => send(...a),
  },
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
const findCandidates = vi.fn();
const scoreCandidates = vi.fn();
vi.mock("../../services/digest.js", () => ({
  DIGEST_SIZE: 5,
  MAX_ATTEMPTS: 9,
  findCandidates: (...a: unknown[]) => findCandidates(...a),
  scoreCandidates: (...a: unknown[]) => scoreCandidates(...a),
}));
const sendPush = vi.fn();
vi.mock("../../services/push.js", () => ({ sendPush: (...a: unknown[]) => sendPush(...a) }));
const summarizeTranscript = vi.fn();
vi.mock("../../services/summarizer.js", () => ({
  summarizeTranscript: (...a: unknown[]) => summarizeTranscript(...a),
}));
class TranscriptNotAvailableError extends Error {}
const fetchTranscript = vi.fn();
vi.mock("../../services/transcript.js", () => ({
  TranscriptNotAvailableError,
  fetchTranscript: (...a: unknown[]) => fetchTranscript(...a),
}));

const { buildDigest, weeklyDigestCron } = await import("../digest.js");
const run = () =>
  (buildDigest as unknown as Handler)({
    event: { data: { userId: "u1" } },
    step: { run: async (_name: string, fn: () => Promise<unknown>) => fn() },
  });

const pick = (videoId: string, score: number) => ({
  videoId,
  title: `Feed title ${videoId}`,
  channelTitle: "Chan",
  publishedAt: "2026-11-20T10:00:00Z",
  description: "",
  score,
  becauseClipId: `clip-${videoId}`,
});
let settings: Record<string, unknown> | null;
const saved = () => db.written("digest_items", "upsert") as Record<string, unknown>[];

beforeEach(() => {
  vi.clearAllMocks();
  settings = { weekly_digest: true, summary_language: "en" };
  db = makeDb((op: Op) => (op.table === "user_settings" ? { data: settings } : { data: null }));
  findCandidates.mockResolvedValue([{ videoId: "a" }]);
  fetchTranscript.mockImplementation(async (id: string) => ({
    text: `words of ${id}`,
    truncated: false,
    title: `Real title ${id}`,
    language: "en",
  }));
  summarizeTranscript.mockResolvedValue({ summary: "tl;dr", keyPoints: [], timestamps: [] });
  sendPush.mockResolvedValue({ sent: 1, dead: 0 });
});

describe("build-digest", () => {
  it("summarizes the closest uploads and tells the person", async () => {
    scoreCandidates.mockResolvedValue([pick("a", 0.9), pick("b", 0.7)]);

    const result = await run();

    expect(result).toMatchObject({ userId: "u1", items: 2 });
    expect(saved()).toEqual([
      expect.objectContaining({
        user_id: "u1",
        youtube_video_id: "a",
        video_title: "Real title a",
        video_channel: "Chan",
        score: 0.9,
        because_clip_id: "clip-a",
        summary_json: { summary: "tl;dr", keyPoints: [], timestamps: [] },
      }),
      expect.objectContaining({ youtube_video_id: "b" }),
    ]);
    expect(saved()[0].digest_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(summarizeTranscript).toHaveBeenCalledWith(
      "words of a",
      "Real title a",
      "English",
      "English",
    );
    expect(sendPush).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        body: "2 new videos from channels you save from, summarized.",
        data: { type: "video_digest" },
      }),
    );
  });

  it("stops at five, and passes over a video with no captions", async () => {
    scoreCandidates.mockResolvedValue(
      ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => pick(id, 0.9 - i / 100)),
    );
    fetchTranscript.mockImplementation(async (id: string) => {
      if (id === "b") throw new TranscriptNotAvailableError("no captions");
      return { text: "words", truncated: true, title: null, language: "en" };
    });

    const result = await run();

    expect(result).toMatchObject({ items: 5 });
    expect(saved().map((r) => r.youtube_video_id)).toEqual(["a", "c", "d", "e", "f"]);
    // No title from YouTube: the feed's title stands. A cut transcript is marked.
    expect(saved()[0]).toMatchObject({
      video_title: "Feed title a",
      summary_json: expect.objectContaining({ truncated: true }),
    });
    expect(fetchTranscript).not.toHaveBeenCalledWith("g");
  });

  it("gives up after nine tries, and stays quiet when nothing could be summarized", async () => {
    scoreCandidates.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => pick(`v${i}`, 0.9 - i / 100)),
    );
    fetchTranscript.mockRejectedValue(new TranscriptNotAvailableError("no captions"));

    const result = await run();

    expect(result).toMatchObject({ items: 0 });
    expect(fetchTranscript).toHaveBeenCalledTimes(9);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("does nothing for a person who has the digest off", async () => {
    settings = { weekly_digest: false, summary_language: "en" };
    expect(await run()).toMatchObject({ items: 0, reason: "digest is off" });
    expect(findCandidates).not.toHaveBeenCalled();
  });

  it("does nothing when the channels have nothing new", async () => {
    findCandidates.mockResolvedValue([]);
    expect(await run()).toMatchObject({ items: 0, reason: "no new uploads" });
    expect(scoreCandidates).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("lets a passing transcript failure through, so the job retries", async () => {
    scoreCandidates.mockResolvedValue([pick("a", 0.9)]);
    fetchTranscript.mockRejectedValue(new Error("network"));
    await expect(run()).rejects.toThrow("network");
  });
});

describe("weekly-digest-cron", () => {
  it("sends one build per person who turned the digest on", async () => {
    db = makeDb(() => ({ data: [{ user_id: "u1" }, { user_id: "u2" }] }));

    const result = await (weeklyDigestCron as unknown as Handler)({});

    expect(result).toEqual({ dispatched: 2 });
    expect(db.ops[0].filters).toEqual([["eq", "weekly_digest", true]]);
    expect(send).toHaveBeenCalledWith([
      { name: "digest/build.requested", data: { userId: "u1" } },
      { name: "digest/build.requested", data: { userId: "u2" } },
    ]);
  });

  it("sends nothing when nobody has it on", async () => {
    db = makeDb(() => ({ data: [] }));
    expect(await (weeklyDigestCron as unknown as Handler)({})).toEqual({ dispatched: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
