import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import { makeDb, passAuth, passCoach, json, type FakeDb, type Op } from "./helpers.js";

let db: FakeDb;
const createSignedUploadUrl = vi.fn();
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: (t: string) => db.from(t),
    storage: { from: () => ({ createSignedUploadUrl: (p: string) => createSignedUploadUrl(p) }) },
  },
}));
const inngestSend = vi.fn();
vi.mock("../../../lib/inngest.js", () => ({
  inngest: { send: (...a: unknown[]) => inngestSend(...a) },
}));
vi.mock("../../../middleware/auth.js", () => passAuth);
vi.mock("../../../middleware/require-coach.js", () => passCoach);

const { coachRoutes } = await import("../index.js");
const app = () => new Hono().route("/api/coach", coachRoutes);
const post = (path: string, body: unknown) => app().request(path, json("POST", body));

/** A database with one person, no bundles yet, and `existing` message ids already stored. */
function intakeDb(
  opts: {
    existing?: string[];
    person?: boolean;
    bundle?: unknown;
    collecting?: { id: string }[];
  } = {},
) {
  let n = 0;
  return makeDb((op: Op) => {
    if (op.table === "coach_people") return { data: opts.person === false ? null : { id: "p1" } };
    if (op.table === "coach_bundles" && op.action === "select") {
      // The lookup of still-collecting bundles for re-sent messages is a list.
      return op.single ? { data: opts.bundle ?? null } : { data: opts.collecting ?? [] };
    }
    if (op.table === "coach_bundles" && op.action === "insert") {
      const p = op.payload as { last_message_at: string };
      return { data: { id: `b${++n}`, status: "collecting", last_message_at: p.last_message_at } };
    }
    if (op.table === "coach_messages" && op.action === "select") {
      return {
        data: (opts.existing ?? []).map((external_id) => ({ external_id, bundle_id: "b9" })),
      };
    }
    if (op.table === "coach_messages" && op.action === "upsert") return { data: [{ id: "m" }] };
    return undefined;
  });
}

const batch = {
  personId: "p1",
  channel: "imessage",
  messages: [
    {
      externalId: "m1",
      direction: "in",
      sentAt: "2026-11-14T09:42:00Z",
      attachments: [{ storagePath: "coach/test-user-id/a.png", mediaType: "image/png" }],
    },
    {
      externalId: "m2",
      direction: "in",
      text: "I like the writing on page 1 more than page 2",
      sentAt: "2026-11-14T09:43:00Z",
    },
  ],
};

describe("coach intake", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Intake");
    inngestSend.mockReset();
    createSignedUploadUrl.mockReset();
    db = intakeDb();
  });

  it("stores two messages sent a minute apart in one bundle and sends one event", async () => {
    const res = await post("/api/coach/intake/messages", batch);
    const body = await res.json();
    expect(body).toMatchObject({ stored: 2, duplicates: 0 });
    expect(body.bundleIds).toEqual(["b1"]);
    expect(db.written("coach_bundles", "insert")).toHaveLength(1);
    const stored = db.written("coach_messages", "upsert") as { bundle_id: string }[];
    expect(stored.map((m) => m.bundle_id)).toEqual(["b1", "b1"]);
    expect(inngestSend).toHaveBeenCalledTimes(1);
    expect(inngestSend).toHaveBeenCalledWith({
      name: "coach/bundle.touched",
      data: { bundleId: "b1", userId: "test-user-id", historical: false },
    });
  });

  it("moves the bundle's last message time forward as messages join it", async () => {
    await post("/api/coach/intake/messages", batch);
    expect(db.written("coach_bundles", "update")).toEqual([
      { last_message_at: "2026-11-14T09:43:00.000Z" },
    ]);
  });

  it("splits messages sent more than the quiet window apart into two bundles", async () => {
    const res = await post("/api/coach/intake/messages", {
      ...batch,
      messages: [batch.messages[0], { ...batch.messages[1], sentAt: "2026-11-14T11:00:00Z" }],
    });
    expect((await res.json()).bundleIds).toEqual(["b1", "b2"]);
    expect(inngestSend).toHaveBeenCalledTimes(2);
  });

  // Review Focus 1: the helper retries an upload after a timeout.
  // The first upload stored the messages but died before announcing the bundle.
  it("announces a still-unread bundle again when its messages are re-uploaded", async () => {
    db = intakeDb({ existing: ["m1", "m2"], collecting: [{ id: "b9" }] });
    const res = await post("/api/coach/intake/messages", batch);
    expect(await res.json()).toEqual({ stored: 0, duplicates: 2, bundleIds: [] });
    expect(db.writtenTables()).toEqual([]);
    expect(inngestSend).toHaveBeenCalledTimes(1);
    expect(inngestSend).toHaveBeenCalledWith({
      name: "coach/bundle.touched",
      data: { bundleId: "b9", userId: "test-user-id" },
    });
  });

  it("starts a new bundle for a live message even right after a historical one", async () => {
    db = intakeDb({
      bundle: {
        id: "b-old",
        status: "collecting",
        last_message_at: "2026-11-14T09:41:30Z",
        historical: true,
      },
    });
    const res = await post("/api/coach/intake/messages", {
      ...batch,
      messages: [batch.messages[1]],
    });
    expect((await res.json()).bundleIds).toEqual(["b1"]);
    expect(db.written("coach_bundles", "insert")[0]).toMatchObject({ historical: false });
  });

  it("rejects an attachment path that climbs out of the caller's folder", async () => {
    const res = await post("/api/coach/intake/messages", {
      personId: "p1",
      channel: "imessage",
      messages: [
        {
          externalId: "m5",
          direction: "in",
          sentAt: "2026-11-14T10:00:00Z",
          attachments: [
            { storagePath: "coach/test-user-id/../someone-else/a.png", mediaType: "image/png" },
          ],
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(db.writtenTables()).toEqual([]);
  });

  it("rejects an attachment that is not an image type we accept", async () => {
    const res = await post("/api/coach/intake/messages", {
      personId: "p1",
      channel: "imessage",
      messages: [
        {
          externalId: "m6",
          direction: "in",
          sentAt: "2026-11-14T10:00:00Z",
          attachments: [{ storagePath: "coach/test-user-id/a.pdf", mediaType: "application/pdf" }],
        },
      ],
    });
    expect(res.status).toBe(400);
  });

  it("stores nothing and sends no event when the same messages are uploaded again", async () => {
    db = intakeDb({ existing: ["m1", "m2"] });
    const res = await post("/api/coach/intake/messages", batch);
    expect(await res.json()).toEqual({ stored: 0, duplicates: 2, bundleIds: [] });
    expect(db.writtenTables()).toEqual([]);
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("counts a message lost to a concurrent upload as a duplicate", async () => {
    db = makeDb((op: Op) => {
      if (op.table === "coach_people") return { data: { id: "p1" } };
      if (op.table === "coach_bundles" && op.action === "insert") {
        return { data: { id: "b1", status: "collecting", last_message_at: "x" } };
      }
      if (op.table === "coach_messages") return { data: [] };
      return undefined;
    });
    const res = await post("/api/coach/intake/messages", {
      ...batch,
      messages: [batch.messages[1]],
    });
    expect(await res.json()).toMatchObject({ stored: 0, duplicates: 1 });
  });

  it("stores an outgoing message without a bundle and sends no event", async () => {
    const res = await post("/api/coach/intake/messages", {
      personId: "p1",
      channel: "imessage",
      messages: [
        { externalId: "m3", direction: "out", text: "On it", sentAt: "2026-11-14T10:00:00Z" },
      ],
    });
    expect(await res.json()).toEqual({ stored: 1, duplicates: 0, bundleIds: [] });
    expect(
      (db.written("coach_messages", "upsert")[0] as { bundle_id: unknown }).bundle_id,
    ).toBeNull();
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("marks a waiting batch sent when its summary goes out to the client", async () => {
    const summary = "Changes are live on Alder House:\n- Sconces now sit above the text on page 2";
    const base = intakeDb();
    db = makeDb((op: Op) => {
      if (op.table === "coach_batches" && op.action === "select") {
        return { data: [{ id: "ba1", summary }] };
      }
      return base.respond(op);
    });
    await post("/api/coach/intake/messages", {
      personId: "p1",
      channel: "imessage",
      messages: [
        { externalId: "m3", direction: "out", text: summary, sentAt: "2026-11-17T10:00:00Z" },
      ],
    });
    expect(db.written("coach_batches", "update")[0]).toMatchObject({ status: "sent" });
  });

  it("does not look for a batch when only the client wrote", async () => {
    await post("/api/coach/intake/messages", batch);
    expect(db.ops.some((o) => o.table === "coach_batches")).toBe(false);
  });

  it("marks a new bundle historical when the batch is from a thread's past", async () => {
    await post("/api/coach/intake/messages", { ...batch, historical: true });
    expect(db.written("coach_bundles", "insert")[0]).toMatchObject({ historical: true });
  });

  it("tells the job when a bundle is history, so it can be read cheaply and after live ones", async () => {
    await post("/api/coach/intake/messages", { ...batch, historical: true });
    expect(inngestSend).toHaveBeenCalledWith({
      name: "coach/bundle.touched",
      data: { bundleId: "b1", userId: "test-user-id", historical: true },
    });
  });

  it("rejects an attachment path outside the caller's folder", async () => {
    const res = await post("/api/coach/intake/messages", {
      personId: "p1",
      channel: "imessage",
      messages: [
        {
          externalId: "m4",
          direction: "in",
          sentAt: "2026-11-14T10:00:00Z",
          attachments: [{ storagePath: "coach/someone-else/a.png", mediaType: "image/png" }],
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(db.writtenTables()).toEqual([]);
  });

  it("404s for a person that is not the caller's", async () => {
    db = intakeDb({ person: false });
    expect((await post("/api/coach/intake/messages", batch)).status).toBe(404);
  });

  it("rejects more than 200 messages in one call", async () => {
    const messages = Array.from({ length: 201 }, (_, i) => ({
      externalId: `x${i}`,
      direction: "in",
      sentAt: "2026-11-14T10:00:00Z",
    }));
    expect((await post("/api/coach/intake/messages", { ...batch, messages })).status).toBe(400);
  });

  it("rejects a message with an unreadable time", async () => {
    const res = await post("/api/coach/intake/messages", {
      ...batch,
      messages: [{ externalId: "m9", direction: "in", sentAt: "yesterday-ish" }],
    });
    expect(res.status).toBe(400);
  });

  it("returns a signed upload url inside the caller's folder", async () => {
    createSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: "https://s/u", token: "tok" },
      error: null,
    });
    const res = await post("/api/coach/intake/upload-url", { mediaType: "image/png" });
    const body = await res.json();
    expect(body.path).toMatch(/^coach\/test-user-id\/[0-9a-f-]{36}\.png$/);
    expect(body).toMatchObject({ signedUrl: "https://s/u", token: "tok" });
  });

  it("records that the Mac helper is alive", async () => {
    const res = await post("/api/coach/intake/heartbeat", {});
    expect(res.status).toBe(200);
    const op = db.ops.find((o) => o.table === "coach_settings" && o.action === "upsert")!;
    expect(op.payload).toMatchObject({
      user_id: "test-user-id",
      helper_seen_at: expect.any(String),
    });
    expect(op.options).toMatchObject({ onConflict: "user_id" });
  });

  it("refuses an unsupported media type for an upload url", async () => {
    const res = await post("/api/coach/intake/upload-url", { mediaType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });
});
