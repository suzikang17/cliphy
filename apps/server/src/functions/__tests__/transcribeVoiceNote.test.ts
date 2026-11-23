import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { makeDb, eqValue, type FakeDb, type Op } from "../../routes/coach/__tests__/helpers.js";

// The job behind a voice note: get the recording's words, put them on the
// clip, and hand it to the job that tags and indexes every clip.

let db: FakeDb;
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
const send = vi.fn();
vi.mock("../../lib/inngest.js", () => ({
  inngest: {
    send: (...a: unknown[]) => send(...a),
    createFunction: (_opts: unknown, fn: unknown) => fn,
  },
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
const signImageUrl = vi.fn();
vi.mock("../../lib/storage.js", () => ({ signImageUrl: (...a: unknown[]) => signImageUrl(...a) }));
const startTranscription = vi.fn();
const checkTranscription = vi.fn();
vi.mock("../../services/transcribe.js", () => ({
  startTranscription: (...a: unknown[]) => startTranscription(...a),
  checkTranscription: (...a: unknown[]) => checkTranscription(...a),
}));

const { transcribeVoiceNote } = await import("../transcribeVoiceNote.js");
const run = (clipId = "c1") =>
  (transcribeVoiceNote as unknown as (a: unknown) => Promise<unknown>)({
    event: { data: { clipId } },
    step: {
      run: async (_n: string, fn: () => Promise<unknown>) => fn(),
      sleep: async (name: string) => {
        sleeps.push(name);
      },
    },
  });

const sleeps: string[] = [];

const voiceClip = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  user_id: "u1",
  source_type: "voice",
  status: "processing",
  source_metadata: { storagePath: "voice/u1/a.m4a", mediaType: "audio/mp4" },
  ...over,
});
const clipDb = (clip: unknown) =>
  makeDb((op: Op) => (op.table === "clips" && op.action === "select" ? { data: clip } : undefined));
const updates = () =>
  db.ops.filter((o) => o.table === "clips" && o.action === "update").map((o) => o.payload);

beforeEach(async () => {
  await layer("unit");
  await epic("Library");
  await feature("Voice notes");
  send.mockReset();
  signImageUrl.mockReset().mockResolvedValue("https://signed/voice/u1/a.m4a");
  startTranscription.mockReset();
  checkTranscription.mockReset();
  sleeps.length = 0;
});

describe("transcribeVoiceNote", () => {
  it("puts the recording's words on the clip, titles it, and sends it on to be tagged", async () => {
    db = clipDb(voiceClip());
    startTranscription.mockResolvedValue({
      done: {
        text: "Remember to ask Maren for the new price list. Also the footer year.",
        seconds: 9.2,
      },
    });
    await run();
    expect(signImageUrl).toHaveBeenCalledWith("voice/u1/a.m4a");
    expect(startTranscription).toHaveBeenCalledWith("https://signed/voice/u1/a.m4a");
    expect(updates()).toEqual([
      {
        content: "Remember to ask Maren for the new price list. Also the footer year.",
        video_title: "Remember to ask Maren for the new price list. Also the footer year.",
        status: "completed",
        error_message: null,
        source_metadata: { storagePath: "voice/u1/a.m4a", mediaType: "audio/mp4", seconds: 9.2 },
      },
    ]);
    const write = db.ops.find((o) => o.table === "clips" && o.action === "update")!;
    expect(eqValue(write, "id")).toBe("c1");
    expect(send).toHaveBeenCalledWith({ name: "clip/embed.requested", data: { clipId: "c1" } });
  });

  it("marks the note failed with the reason when there is nothing to hear, and does not retry", async () => {
    db = clipDb(voiceClip());
    startTranscription.mockRejectedValue(new Error("No speech found in the recording"));
    await expect(run()).rejects.toThrow("No speech found in the recording");
    expect(updates()).toEqual([
      { status: "failed", error_message: "No speech found in the recording" },
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves the note waiting when the service is down, so the retry can finish it", async () => {
    db = clipDb(voiceClip());
    startTranscription.mockRejectedValue(new Error("Deepgram 503: unavailable"));
    await expect(run()).rejects.toThrow("Deepgram 503");
    expect(updates()).toEqual([]);
  });

  it("does nothing for a clip that is not a voice note or is already done", async () => {
    db = clipDb(voiceClip({ source_type: "note" }));
    await run();
    db = clipDb(voiceClip({ status: "completed" }));
    await run();
    db = clipDb(null);
    await run();
    expect(startTranscription).not.toHaveBeenCalled();
  });

  it("waits on a service that takes its time, asking again until the words are in", async () => {
    db = clipDb(voiceClip());
    startTranscription.mockResolvedValue({ jobId: "job1" });
    checkTranscription
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ text: "Fix the footer year.", seconds: 4 });
    await run();
    expect(checkTranscription).toHaveBeenCalledTimes(3);
    expect(checkTranscription).toHaveBeenCalledWith("job1");
    // A pause before each look, so no single call has to wait.
    expect(sleeps).toHaveLength(3);
    expect(updates()[0]).toMatchObject({ content: "Fix the footer year.", status: "completed" });
    expect(send).toHaveBeenCalledWith({ name: "clip/embed.requested", data: { clipId: "c1" } });
  });

  it("gives up with a reason when the service never finishes", async () => {
    db = clipDb(voiceClip());
    startTranscription.mockResolvedValue({ jobId: "job1" });
    checkTranscription.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("Transcription took too long");
    expect(updates()).toEqual([{ status: "failed", error_message: "Transcription took too long" }]);
  });

  it("marks the note failed when the service's job fails", async () => {
    db = clipDb(voiceClip());
    startTranscription.mockResolvedValue({ jobId: "job1" });
    checkTranscription.mockRejectedValue(new Error("No speech found in the recording"));
    await expect(run()).rejects.toThrow("No speech found");
    expect(updates()).toEqual([
      { status: "failed", error_message: "No speech found in the recording" },
    ]);
  });
});
