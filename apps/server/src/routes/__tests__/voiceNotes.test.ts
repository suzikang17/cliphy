import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import { makeDb, passAuth, json, type FakeDb, type Op } from "../coach/__tests__/helpers.js";

// Voice notes and plain notes: saved as clips, then read and tagged by the
// same job as everything else.

let db: FakeDb;
const createSignedUploadUrl = vi.fn();
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: (t: string) => db.from(t),
    storage: { from: () => ({ createSignedUploadUrl }) },
  },
}));
const send = vi.fn();
vi.mock("../../lib/inngest.js", () => ({ inngest: { send: (...a: unknown[]) => send(...a) } }));
vi.mock("../../middleware/auth.js", () => passAuth);

const { notesRoutes } = await import("../notes.js");
const app = () => new Hono().route("/api/notes", notesRoutes);
const post = (path: string, body: unknown = {}) =>
  app().request(`/api/notes${path}`, json("POST", body));

const clipDb = () =>
  makeDb((op: Op) =>
    op.table === "clips" && op.action === "insert"
      ? { data: { id: "c1", status: "processing", tags: [], ...(op.payload as object) } }
      : undefined,
  );

beforeEach(async () => {
  await layer("unit");
  await epic("Library");
  await feature("Voice notes");
  send.mockReset();
  createSignedUploadUrl.mockReset();
  db = clipDb();
});

describe("POST /notes/voice/upload-url", () => {
  it("gives a place in the caller's own folder to put a recording", async () => {
    createSignedUploadUrl.mockResolvedValue({ data: { signedUrl: "https://up", token: "t" } });
    const res = await post("/voice/upload-url", { mediaType: "audio/mp4" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; signedUrl: string; token: string };
    expect(body.path).toMatch(/^voice\/test-user-id\/[0-9a-f-]{36}\.m4a$/);
    expect(body.signedUrl).toBe("https://up");
    expect(createSignedUploadUrl).toHaveBeenCalledWith(body.path);
  });

  it("takes the kinds of audio a phone or a browser records, and nothing else", async () => {
    createSignedUploadUrl.mockResolvedValue({ data: { signedUrl: "https://up", token: "t" } });
    // A browser adds the codec after the type.
    expect((await post("/voice/upload-url", { mediaType: "audio/webm;codecs=opus" })).status).toBe(
      200,
    );
    expect((await post("/voice/upload-url", { mediaType: "video/mp4" })).status).toBe(400);
    expect((await post("/voice/upload-url", {})).status).toBe(400);
  });
});

describe("POST /notes/voice", () => {
  it("saves the recording as a clip still to be read, and asks for it to be transcribed", async () => {
    const res = await post("/voice", {
      storagePath: "voice/test-user-id/a.m4a",
      mediaType: "audio/mp4",
      seconds: 42.5,
    });
    expect(res.status).toBe(201);
    expect(db.written("clips", "insert")[0]).toMatchObject({
      user_id: "test-user-id",
      source_type: "voice",
      status: "processing",
      content: "",
      tags: [],
      source_metadata: {
        storagePath: "voice/test-user-id/a.m4a",
        mediaType: "audio/mp4",
        seconds: 42.5,
      },
    });
    expect(send).toHaveBeenCalledWith({ name: "voice/note.transcribe", data: { clipId: "c1" } });
  });

  it("refuses a recording that is not in the caller's own folder", async () => {
    for (const storagePath of [
      "voice/someone-else/a.m4a",
      "voice/test-user-id/../x.m4a",
      "coach/test-user-id/a.png",
      "",
    ]) {
      expect((await post("/voice", { storagePath, mediaType: "audio/mp4" })).status).toBe(400);
    }
    expect(db.written("clips")).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("POST /notes", () => {
  it("saves a note of its own, apart from the day's note, and sends it to be tagged", async () => {
    const res = await post("", {
      text: "  Idea: a gallery page for the porch shoot\nwith captions  ",
    });
    expect(res.status).toBe(201);
    const row = db.written("clips", "insert")[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      user_id: "test-user-id",
      source_type: "note",
      content: "Idea: a gallery page for the porch shoot\nwith captions",
      video_title: "Idea: a gallery page for the porch shoot",
      status: "completed",
    });
    // No date on it: it is not the day's running note.
    expect(row.source_metadata).toEqual({});
    expect(send).toHaveBeenCalledWith({ name: "clip/embed.requested", data: { clipId: "c1" } });
  });

  it("refuses an empty note", async () => {
    expect((await post("", { text: "   " })).status).toBe(400);
    expect(db.written("clips")).toEqual([]);
  });
});
