import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type { CapturedPerson, IntakeMessage, ThreadMessage } from "../plan.js";
import type { ReadOptions } from "../messagesDb.js";
import {
  BATCH_SIZE,
  MAX_BATCHES_PER_CYCLE,
  emptyState,
  syncOnce,
  type HelperState,
  type SyncDeps,
} from "../sync.js";

const maren: CapturedPerson = {
  id: "p1",
  name: "Maren",
  handles: ["+15550100"],
  captureThread: true,
  historyWindow: "new",
  historyDays: null,
};

const row = (rowId: number, over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  rowId,
  guid: `g-${rowId}`,
  text: `message ${rowId}`,
  sentAtIso: "2026-11-14T17:40:00.000Z",
  isFromMe: false,
  attachments: [],
  ...over,
});

interface Posted {
  personId: string;
  historical: boolean;
  messages: IntakeMessage[];
}

/** A fake world: a thread of rows, and an API that records what it was sent. */
function world(
  opts: { people?: CapturedPerson[]; rows?: ThreadMessage[]; state?: HelperState } = {},
) {
  const rows = opts.rows ?? [];
  const posted: Posted[] = [];
  const reads: ReadOptions[] = [];
  const uploads: string[] = [];
  const logs: string[] = [];
  const fail = { post: false, put: false, people: false };
  let saves = 0;
  let heartbeats = 0;
  const state = opts.state ?? emptyState();

  const deps: SyncDeps = {
    api: {
      people: async () => {
        if (fail.people) throw new Error("offline");
        return opts.people ?? [maren];
      },
      uploadUrl: async (mediaType) => {
        uploads.push(mediaType);
        return { path: `coach/u/${uploads.length}.jpg`, signedUrl: `https://up/${uploads.length}` };
      },
      put: async () => {
        if (fail.put) throw new Error("upload failed");
      },
      postMessages: async (body) => {
        if (fail.post) throw new Error("server down");
        posted.push(body);
      },
      heartbeat: async () => {
        heartbeats++;
      },
    },
    messages: {
      read: (o) => {
        reads.push(o);
        return rows
          .filter(
            (r) => r.rowId > o.afterRowId && (o.sinceIso === null || r.sentAtIso >= o.sinceIso),
          )
          .slice(0, o.limit);
      },
      maxRowId: () => Math.max(0, ...rows.map((r) => r.rowId)),
    },
    images: {
      prepare: async (file, mimeType) => {
        if (file.includes("missing") || !mimeType?.startsWith("image/")) return null;
        // HEIC is converted; everything else passes through.
        return {
          bytes: Buffer.from("x"),
          mediaType: mimeType === "image/heic" ? "image/jpeg" : mimeType,
        };
      },
    },
    state,
    save: () => {
      saves++;
    },
    now: () => new Date("2026-11-14T18:00:00Z"),
    log: (m) => logs.push(m),
  };
  return {
    deps,
    posted,
    reads,
    uploads,
    logs,
    fail,
    state,
    saves: () => saves,
    heartbeats: () => heartbeats,
  };
}

const connected = (cursor: number): HelperState => ({
  cursors: { p1: cursor },
  connected: { p1: true },
  backfill: {},
});

describe("mac helper sync", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Mac helper");
  });

  it("uploads new messages for a connected person and moves the cursor past them", async () => {
    const w = world({
      rows: [row(10), row(11), row(12, { isFromMe: true })],
      state: connected(10),
    });
    const out = await syncOnce(w.deps);
    expect(out.uploaded).toBe(2);
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0]).toMatchObject({ personId: "p1", historical: false });
    expect(w.posted[0].messages.map((m) => [m.externalId, m.direction])).toEqual([
      ["g-11", "in"],
      ["g-12", "out"],
    ]);
    expect(w.state.cursors.p1).toBe(12);
    expect(w.saves()).toBeGreaterThan(0);
  });

  it("does nothing when there is nothing new, but still reports it is alive", async () => {
    const w = world({ rows: [row(10)], state: connected(10) });
    expect((await syncOnce(w.deps)).uploaded).toBe(0);
    expect(w.posted).toEqual([]);
    expect(w.heartbeats()).toBe(1);
  });

  // Review Focus 1: the upload fails.
  it("does not move the cursor when the server rejects a batch, so the next cycle sends it again", async () => {
    const w = world({ rows: [row(11), row(12)], state: connected(10) });
    w.fail.post = true;
    await syncOnce(w.deps);
    expect(w.state.cursors.p1).toBe(10);

    w.fail.post = false;
    await syncOnce(w.deps);
    expect(w.posted[0].messages.map((m) => m.externalId)).toEqual(["g-11", "g-12"]);
    expect(w.state.cursors.p1).toBe(12);
  });

  it("does not post a batch whose attachment upload failed, and does not move the cursor", async () => {
    const w = world({
      rows: [row(11, { attachments: [{ path: "/a/page1.png", mimeType: "image/png" }] })],
      state: connected(10),
    });
    w.fail.put = true;
    await syncOnce(w.deps);
    expect(w.posted).toEqual([]);
    expect(w.state.cursors.p1).toBe(10);
  });

  it("uploads each attachment and sends its storage path with the message", async () => {
    const w = world({
      rows: [
        row(11, {
          text: "",
          attachments: [
            { path: "/a/page1.png", mimeType: "image/png" },
            { path: "/a/page2.heic", mimeType: "image/heic" },
          ],
        }),
      ],
      state: connected(10),
    });
    await syncOnce(w.deps);
    // HEIC is uploaded as the JPEG it was converted to.
    expect(w.uploads).toEqual(["image/png", "image/jpeg"]);
    expect(w.posted[0].messages[0].attachments).toEqual([
      { storagePath: "coach/u/1.jpg", mediaType: "image/png" },
      { storagePath: "coach/u/2.jpg", mediaType: "image/jpeg" },
    ]);
  });

  // Review Focus 4: an attachment that is missing or not an image.
  it("still sends a message whose attachment is not on disk or is not an image, and counts what it skipped", async () => {
    const w = world({
      rows: [
        row(11, {
          attachments: [
            { path: null, mimeType: "image/png" },
            { path: "/a/missing.png", mimeType: "image/png" },
            { path: "/a/contract.pdf", mimeType: "application/pdf" },
            { path: "/a/ok.png", mimeType: "image/png" },
          ],
        }),
      ],
      state: connected(10),
    });
    const out = await syncOnce(w.deps);
    expect(out.skippedAttachments).toBe(3);
    expect(w.posted[0].messages[0].attachments).toHaveLength(1);
    expect(w.state.cursors.p1).toBe(11);
  });

  // Review Focus 5: the Mac was off for a week.
  it("catches up in order, in bounded batches, over as many cycles as it takes", async () => {
    const total = BATCH_SIZE * MAX_BATCHES_PER_CYCLE + 30;
    const rows = Array.from({ length: total }, (_, i) => row(i + 1));
    const w = world({ rows, state: connected(0) });

    const first = await syncOnce(w.deps);
    expect(first.uploaded).toBe(BATCH_SIZE * MAX_BATCHES_PER_CYCLE);
    expect(w.posted).toHaveLength(MAX_BATCHES_PER_CYCLE);
    expect(w.posted.every((p) => p.messages.length <= BATCH_SIZE)).toBe(true);

    const second = await syncOnce(w.deps);
    expect(second.uploaded).toBe(30);
    const sent = w.posted.flatMap((p) => p.messages.map((m) => m.externalId));
    expect(sent).toEqual(rows.map((r) => r.guid));
  });

  it("starts from now for a person whose history choice is new messages only", async () => {
    const w = world({ rows: [row(1), row(2), row(3)] });
    const out = await syncOnce(w.deps);
    expect(out.uploaded).toBe(0);
    expect(w.posted).toEqual([]);
    expect(w.state.connected.p1).toBe(true);
    expect(w.state.cursors.p1).toBe(3);
  });

  it("reads back a window as history the first time, then carries on with new messages", async () => {
    const rows = [
      row(1, { sentAtIso: "2022-03-01T10:00:00.000Z" }),
      row(2, { sentAtIso: "2026-10-01T10:00:00.000Z" }),
      row(3, { sentAtIso: "2026-11-10T10:00:00.000Z" }),
    ];
    const w = world({ rows, people: [{ ...maren, historyWindow: "window", historyDays: 90 }] });
    await syncOnce(w.deps);
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0].historical).toBe(true);
    expect(w.posted[0].messages.map((m) => m.externalId)).toEqual(["g-2", "g-3"]);
    expect(w.state.connected.p1).toBe(true);
    expect(w.state.cursors.p1).toBe(3);

    rows.push(row(4));
    await syncOnce(w.deps);
    expect(w.posted[1]).toMatchObject({ historical: false });
    expect(w.posted[1].messages.map((m) => m.externalId)).toEqual(["g-4"]);
  });

  it("never uploads messages older than the window, even when the window held nothing", async () => {
    const rows = [row(1, { sentAtIso: "2022-03-01T10:00:00.000Z" })];
    const w = world({ rows, people: [{ ...maren, historyWindow: "window", historyDays: 30 }] });
    await syncOnce(w.deps);
    await syncOnce(w.deps);
    expect(w.posted).toEqual([]);
    expect(w.state.cursors.p1).toBe(1);
  });

  it("keeps the same window across cycles when the history is long", async () => {
    const total = BATCH_SIZE * MAX_BATCHES_PER_CYCLE + 5;
    const rows = Array.from({ length: total }, (_, i) => row(i + 1));
    const w = world({ rows, people: [{ ...maren, historyWindow: "all" }] });
    await syncOnce(w.deps);
    expect(w.state.connected.p1).toBeFalsy();
    await syncOnce(w.deps);
    expect(w.state.connected.p1).toBe(true);
    expect(w.posted.every((p) => p.historical)).toBe(true);
    expect(w.posted.flatMap((p) => p.messages)).toHaveLength(total);
  });

  it("ignores people whose thread is not captured or who have no handle", async () => {
    const w = world({
      rows: [row(1)],
      people: [
        { ...maren, captureThread: false },
        { ...maren, id: "p2", handles: [] },
      ],
    });
    await syncOnce(w.deps);
    expect(w.reads).toEqual([]);
    expect(w.state.connected).toEqual({});
  });

  it("carries on with the next person when one fails", async () => {
    const w = world({
      rows: [row(11)],
      people: [maren, { ...maren, id: "p2", name: "Jo" }],
      state: { cursors: { p1: 10, p2: 10 }, connected: { p1: true, p2: true }, backfill: {} },
    });
    let calls = 0;
    const post = w.deps.api.postMessages;
    w.deps.api.postMessages = async (body) => {
      calls++;
      if (calls === 1) throw new Error("server down");
      return post(body);
    };
    await syncOnce(w.deps);
    expect(w.posted.map((p) => p.personId)).toEqual(["p2"]);
    expect(w.heartbeats()).toBe(1);
  });

  it("reports when it cannot reach the server at all, uploading nothing", async () => {
    const w = world({ rows: [row(11)], state: connected(10) });
    w.fail.people = true;
    const out = await syncOnce(w.deps);
    expect(out).toMatchObject({ uploaded: 0, offline: true });
    expect(w.state.cursors.p1).toBe(10);
  });
});
