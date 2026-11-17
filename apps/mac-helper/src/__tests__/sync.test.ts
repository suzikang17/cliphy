import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type { CapturedPerson, IntakeMessage, ThreadMessage } from "../plan.js";
import type { ReadOptions } from "../messagesDb.js";
import {
  ApiError,
  ATTACHMENT_TRIES,
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
const image = (path: string | null, over: Partial<ThreadMessage["attachments"][number]> = {}) => ({
  path,
  mimeType: "image/png",
  ready: path !== null,
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
  const layouts: { personId: string; items: { externalId: string; at: number[] }[] }[] = [];
  const fail: { post: boolean; put: false | "network" | 413; people: boolean; layout: boolean } = {
    post: false,
    put: false,
    people: false,
    layout: false,
  };
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
        if (fail.put === "network") throw new Error("upload failed");
        if (fail.put) throw new ApiError("Upload → 413", fail.put);
      },
      postMessages: async (body) => {
        if (fail.post) throw new Error("server down");
        posted.push(body);
      },
      heartbeat: async () => {
        heartbeats++;
      },
      layout: async (body) => {
        if (fail.layout) throw new Error("server down");
        layouts.push(body);
      },
    },
    messages: {
      read: (o) => {
        reads.push(o);
        return rows
          .filter(
            (r) =>
              r.rowId > o.afterRowId &&
              (o.uptoRowId == null || r.rowId <= o.uptoRowId) &&
              (o.sinceIso === null || r.sentAtIso >= o.sinceIso),
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
    layouts,
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
  ...emptyState(),
  cursors: { p1: cursor },
  connected: { p1: true },
  handles: { p1: "+15550100" },
  lastSyncAt: "2026-11-14T17:59:40.000Z",
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
      rows: [row(11, { attachments: [image("/a/page1.png")] })],
      state: connected(10),
    });
    w.fail.put = "network";
    await syncOnce(w.deps);
    expect(w.posted).toEqual([]);
    expect(w.state.cursors.p1).toBe(10);
  });

  it("uploads each attachment and sends its storage path with the message", async () => {
    const w = world({
      rows: [
        row(11, {
          text: "",
          attachments: [image("/a/page1.png"), image("/a/page2.heic", { mimeType: "image/heic" })],
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
            image(null, { ready: true }),
            image("/a/missing.png"),
            image("/a/contract.pdf", { mimeType: "application/pdf" }),
            image("/a/ok.png"),
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
      state: {
        ...emptyState(),
        cursors: { p1: 10, p2: 10 },
        connected: { p1: true, p2: true },
        handles: { p1: "+15550100", p2: "+15550100" },
        lastSyncAt: "2026-11-14T17:59:40.000Z",
      },
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

  // A message that arrives while history is being read must not be buried as history.
  it("sends messages that arrive during a history read as live, not as history", async () => {
    const rows = [
      row(1, { sentAtIso: "2026-10-01T10:00:00.000Z" }),
      row(2, { sentAtIso: "2026-11-01T10:00:00.000Z" }),
    ];
    const w = world({ rows, people: [{ ...maren, historyWindow: "all" }] });
    // The thread stood at row 2 when the history read began; row 3 arrives during it.
    const read = w.deps.messages.read;
    let added = false;
    w.deps.messages.read = (o) => {
      if (!added) {
        added = true;
        rows.push(row(3, { sentAtIso: "2026-11-14T17:59:50.000Z" }));
      }
      return read(o);
    };
    await syncOnce(w.deps);
    await syncOnce(w.deps);
    const ids = (historical: boolean) =>
      w.posted
        .filter((p) => p.historical === historical)
        .flatMap((p) => p.messages.map((m) => m.externalId));
    expect(ids(true)).toEqual(["g-1", "g-2"]);
    expect(ids(false)).toEqual(["g-3"]);
  });

  // One attachment the server will never take must not block the thread for good.
  it("sends the message without an attachment the server refuses outright", async () => {
    const w = world({
      rows: [row(11, { attachments: [image("/a/huge.png")] }), row(12)],
      state: connected(10),
    });
    w.fail.put = 413;
    const out = await syncOnce(w.deps);
    expect(out.skippedAttachments).toBe(1);
    expect(w.posted[0].messages.map((m) => [m.externalId, m.attachments.length])).toEqual([
      ["g-11", 0],
      ["g-12", 0],
    ]);
    expect(w.state.cursors.p1).toBe(12);
  });

  it("gives up on an attachment that keeps failing after a few cycles, and sends the message without it", async () => {
    const w = world({
      rows: [row(11, { attachments: [image("/a/flaky.png")] })],
      state: connected(10),
    });
    w.fail.put = "network";
    for (let i = 0; i < ATTACHMENT_TRIES - 1; i++) {
      await syncOnce(w.deps);
      expect(w.posted).toEqual([]);
    }
    await syncOnce(w.deps);
    expect(w.posted[0].messages[0].attachments).toEqual([]);
    expect(w.state.cursors.p1).toBe(11);
  });

  it("does not upload an attachment again when a later one in the batch fails", async () => {
    const w = world({
      rows: [row(11, { attachments: [image("/a/one.png"), image("/a/two.png")] })],
      state: connected(10),
    });
    let puts = 0;
    w.deps.api.put = async () => {
      puts++;
      if (puts === 2) throw new Error("network blip");
    };
    await syncOnce(w.deps);
    await syncOnce(w.deps);
    // one.png once, two.png twice: three puts, not four.
    expect(puts).toBe(3);
    expect(w.posted[0].messages[0].attachments).toHaveLength(2);
  });

  // Messages re-synced from iCloud get new row ids but are old.
  it("treats a long-old message that shows up with a new row id as history", async () => {
    const w = world({
      rows: [
        row(11, { sentAtIso: "2026-09-01T10:00:00.000Z" }),
        row(12, { sentAtIso: "2026-11-14T17:59:55.000Z" }),
      ],
      state: connected(10),
    });
    await syncOnce(w.deps);
    expect(w.posted.map((p) => [p.historical, p.messages.map((m) => m.externalId)])).toEqual([
      [true, ["g-11"]],
      [false, ["g-12"]],
    ]);
    expect(w.state.cursors.p1).toBe(12);
  });

  it("still treats a week of missed messages as live when the Mac was off", async () => {
    const w = world({
      rows: [
        row(11, { sentAtIso: "2026-11-10T10:00:00.000Z" }),
        row(12, { sentAtIso: "2026-11-13T10:00:00.000Z" }),
      ],
      state: { ...connected(10), lastSyncAt: "2026-11-07T09:00:00.000Z" },
    });
    await syncOnce(w.deps);
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0].historical).toBe(false);
  });

  it("records when it last synced, so old messages can be told from missed ones", async () => {
    const w = world({ rows: [], state: connected(0) });
    await syncOnce(w.deps);
    expect(w.state.lastSyncAt).toBe("2026-11-14T18:00:00.000Z");
  });

  // Turning capture off and on must honour the new choice, and not upload what was sent in between.
  it("forgets a person when their capture is turned off", async () => {
    const w = world({
      rows: [row(11)],
      people: [{ ...maren, captureThread: false }],
      state: connected(10),
    });
    await syncOnce(w.deps);
    expect(w.state.connected.p1).toBeUndefined();
    expect(w.state.cursors.p1).toBeUndefined();

    // Turned back on as "new only": what arrived while it was off is not uploaded.
    w.deps.api.people = async () => [maren];
    await syncOnce(w.deps);
    expect(w.posted).toEqual([]);
    expect(w.state.cursors.p1).toBe(11);
  });

  it("starts a person over when their phone number changes, so history is read for the right thread", async () => {
    const w = world({
      rows: [row(1, { sentAtIso: "2026-11-01T10:00:00.000Z" })],
      people: [{ ...maren, handles: ["+15550111"], historyWindow: "all" }],
      state: connected(1),
    });
    await syncOnce(w.deps);
    expect(w.posted[0]).toMatchObject({ historical: true });
    expect(w.state.handles.p1).toBe("+15550111");
  });

  // A photo that is still downloading: wait for it instead of sending the message without it.
  it("waits for a recent message whose photo is still downloading", async () => {
    const w = world({
      rows: [
        row(11),
        row(12, {
          sentAtIso: "2026-11-14T17:59:30.000Z",
          attachments: [image(null, { ready: false })],
        }),
        row(13),
      ],
      state: connected(10),
    });
    await syncOnce(w.deps);
    expect(w.posted[0].messages.map((m) => m.externalId)).toEqual(["g-11"]);
    expect(w.state.cursors.p1).toBe(11);
  });

  it("stops waiting for a photo that never arrives", async () => {
    const w = world({
      rows: [
        row(12, {
          sentAtIso: "2026-11-14T17:30:00.000Z",
          attachments: [image(null, { ready: false })],
        }),
      ],
      state: connected(10),
    });
    const out = await syncOnce(w.deps);
    expect(out.skippedAttachments).toBe(1);
    expect(w.state.cursors.p1).toBe(12);
  });

  // An unsent message, or one whose only attachment was skipped, says nothing.
  it("does not upload a message with no words and no attachment, but moves past it", async () => {
    const w = world({
      rows: [
        row(11, { text: "" }),
        row(12, {
          text: "",
          attachments: [image("/a/contract.pdf", { mimeType: "application/pdf" })],
        }),
        row(13),
      ],
      state: connected(10),
    });
    await syncOnce(w.deps);
    expect(w.posted[0].messages.map((m) => m.externalId)).toEqual(["g-13"]);
    expect(w.state.cursors.p1).toBe(13);
  });

  it("moves past a batch that had nothing worth sending", async () => {
    const w = world({ rows: [row(11, { text: "" })], state: connected(10) });
    await syncOnce(w.deps);
    expect(w.posted).toEqual([]);
    expect(w.state.cursors.p1).toBe(11);
  });
});

describe("changing how far back to read, for someone already captured", () => {
  beforeEach(async () => {
    await layer("unit");
    await epic("Coach");
    await feature("Mac helper");
  });

  const thread = [row(1), row(2), row(3)];

  it("reads the whole thread once the choice becomes everything", async () => {
    const w = world({ rows: thread });
    await syncOnce(w.deps); // "new": starts from now, uploads nothing.
    expect(w.posted).toEqual([]);

    const everything = world({
      people: [{ ...maren, historyWindow: "all" }],
      rows: thread,
      state: w.state,
    });
    await syncOnce(everything.deps);
    expect(everything.posted.flatMap((p) => p.messages.map((m) => m.externalId))).toEqual([
      "g-1",
      "g-2",
      "g-3",
    ]);
    expect(everything.posted.every((p) => p.historical)).toBe(true);
  });

  it("does not read again while the choice stays the same", async () => {
    const all = { ...maren, historyWindow: "all" as const };
    const w = world({ people: [all], rows: thread });
    await syncOnce(w.deps);
    const again = world({ people: [all], rows: thread, state: w.state });
    await syncOnce(again.deps);
    expect(again.posted).toEqual([]);
  });

  it("reads back for someone captured by an older helper that kept no record of the choice", async () => {
    const before = emptyState();
    before.connected.p1 = true;
    before.cursors.p1 = 3;
    before.handles.p1 = "+15550100";
    const w = world({ people: [{ ...maren, historyWindow: "all" }], rows: thread, state: before });
    await syncOnce(w.deps);
    expect(w.posted.flatMap((p) => p.messages)).toHaveLength(3);
  });

  it("leaves someone on new-only alone when an older helper kept no record", async () => {
    const before = emptyState();
    before.connected.p1 = true;
    before.cursors.p1 = 3;
    before.handles.p1 = "+15550100";
    const w = world({ rows: thread, state: before });
    await syncOnce(w.deps);
    expect(w.posted).toEqual([]);
  });
});

describe("where pictures sit in a message", () => {
  beforeEach(async () => {
    await layer("unit");
    await epic("Coach");
    await feature("Mac helper");
  });

  const placed = (rowId: number) =>
    row(rowId, {
      text: "Use this one: and this for Details:",
      attachments: [image("/a.png", { at: 13 }), image("/b.png", { at: 35 })],
    });

  it("sends each picture's place along with a new message", async () => {
    const w = world({ rows: [placed(5)], state: connected(4) });
    await syncOnce(w.deps);
    expect(w.posted[0].messages[0].attachments.map((a) => a.at)).toEqual([13, 35]);
  });

  it("reports the places once for messages uploaded before places were kept", async () => {
    const w = world({ rows: [row(1), placed(2), placed(3)], state: connected(3) });
    await syncOnce(w.deps);
    expect(w.posted).toEqual([]);
    expect(w.uploads).toEqual([]);
    expect(w.layouts).toEqual([
      {
        personId: "p1",
        items: [
          { externalId: "g-2", at: [13, 35] },
          { externalId: "g-3", at: [13, 35] },
        ],
      },
    ]);

    const again = world({ rows: [row(1), placed(2), placed(3)], state: w.state });
    await syncOnce(again.deps);
    expect(again.layouts).toEqual([]);
  });

  it("leaves out pictures that were never uploaded, and tries again if the server is unreachable", async () => {
    const mixed = row(2, {
      text: "one two",
      attachments: [
        image("/a.png", { at: 3 }),
        image("/clip.mov", { at: 3, mimeType: "video/quicktime" }),
        image("/b.png", { at: 7 }),
      ],
    });
    const w = world({ rows: [mixed], state: connected(2) });
    w.fail.layout = true;
    await syncOnce(w.deps);
    expect(w.layouts).toEqual([]);
    w.fail.layout = false;
    await syncOnce(w.deps);
    expect(w.layouts[0].items).toEqual([{ externalId: "g-2", at: [3, 7] }]);
  });
});
