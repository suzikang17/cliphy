import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { makeDb, eqValue, type FakeDb, type Op } from "../../routes/coach/__tests__/helpers.js";
import type { Interpretation } from "../../services/coach/interpret.js";

let db: FakeDb;
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
const inngestSend = vi.fn();
vi.mock("../../lib/inngest.js", () => ({
  inngest: {
    createFunction: (_c: unknown, fn: unknown) => fn,
    send: (...a: unknown[]) => inngestSend(...a),
  },
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
const downloadImage = vi.fn();
vi.mock("../../lib/storage.js", () => ({
  downloadImage: (...a: unknown[]) => downloadImage(...a),
}));
const interpretMock = vi.fn();
vi.mock("../../services/coach/interpret.js", () => ({
  interpretBundle: (...a: unknown[]) => interpretMock(...a),
}));
const createImageClipMock = vi.fn();
vi.mock("../../services/imageClip.js", () => ({
  createImageClip: (...a: unknown[]) => createImageClipMock(...a),
}));

const {
  processBundle,
  storeInterpretation,
  markBundleFailed,
  sweepBundles,
  BUNDLE_JOB,
  RETRY_JOB,
} = await import("../processBundle.js");

const bundle = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  user_id: "u1",
  person_id: "p1",
  status: "collecting",
  historical: false,
  fix_note: null,
  ...over,
});

const messages = () => [
  {
    id: "m1",
    person_id: "p1",
    channel: "imessage",
    direction: "in",
    text: "I like the writing on page 1 more than page 2",
    attachments: [],
    sent_at: "2026-11-14T09:42:40Z",
  },
];
const messagesWithTwoImages = () => [
  {
    id: "m1",
    person_id: "p1",
    channel: "imessage",
    direction: "in",
    text: "",
    attachments: [{ storagePath: "coach/u1/a.png", mediaType: "image/png" }],
    sent_at: "2026-11-14T09:42:00Z",
  },
  {
    id: "m2",
    person_id: "p1",
    channel: "imessage",
    direction: "in",
    text: "",
    attachments: [{ storagePath: "coach/u1/b.png", mediaType: "image/png" }],
    sent_at: "2026-11-14T09:42:05Z",
  },
];

const requestInterp = (over: Partial<Interpretation> = {}): Interpretation => ({
  kind: "request",
  understood: "Maren asked to replace the page 2 text.",
  projectId: "pr1",
  newProjectName: null,
  question: { text: "Words or type?", options: ["Only words", "Type too"] },
  replacesRequestId: "r-2022",
  repliesToTaskId: null,
  dueDate: null,
  tasks: [
    {
      kind: "ask",
      title: "Words or type?",
      withPerson: true,
      after: null,
      answersQuestion: true,
      kit: {},
    },
    {
      kind: "do",
      title: "Replace page 2 copy",
      withPerson: false,
      after: 0,
      answersQuestion: false,
      kit: {},
    },
    {
      kind: "tell",
      title: "Tell Maren it's live",
      withPerson: true,
      after: 1,
      answersQuestion: false,
      kit: {},
    },
  ],
  ...over,
});
const chatInterp = (): Interpretation => ({
  ...requestInterp(),
  kind: "chat",
  understood: "",
  projectId: null,
  question: null,
  replacesRequestId: null,
  tasks: [],
});
const replyInterp = (taskId: string): Interpretation => ({
  ...chatInterp(),
  kind: "reply",
  understood: "Maren said only the words.",
  repliesToTaskId: taskId,
});

/** Answers the lookups and writes storeInterpretation and the job make. */
function storeDb(bundleRow = bundle(), messageRows: unknown[] = messages()) {
  return makeDb((op: Op) => {
    if (op.table === "coach_bundles" && op.action === "select") return { data: bundleRow };
    if (op.table === "coach_messages" && op.action === "select") return { data: messageRows };
    if (op.table === "coach_people") return { data: { id: "p1", name: "Maren" } };
    if (op.table === "coach_projects" && op.action === "select") {
      return op.single
        ? { data: { id: "pr1", name: "Alder House", tag: "project:alder-house" } }
        : { data: [{ id: "pr1", name: "Alder House", tag: "project:alder-house" }] };
    }
    if (op.table === "coach_projects" && op.action === "insert") {
      return { data: { id: "pr-new", ...(op.payload as object) } };
    }
    if (op.table === "coach_requests" && op.action === "upsert") return { data: { id: "r1" } };
    return { data: [] };
  });
}

const run = (data: unknown, attempt = 0) =>
  (processBundle as unknown as (a: unknown) => Promise<unknown>)({
    event: { data },
    attempt,
    step: { run: async (_n: string, fn: () => Promise<unknown>) => fn() },
  });

describe("coach processBundle", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Process bundle");
    interpretMock.mockReset();
    createImageClipMock.mockReset();
    downloadImage.mockReset();
    createImageClipMock.mockImplementation(async () => ({ id: "clip-1" }));
    downloadImage.mockResolvedValue({ bytes: Buffer.from("x"), mediaType: "image/png" });
    db = storeDb();
  });

  describe("storeInterpretation", () => {
    it("stores a request with its proposed chain for a request bundle", async () => {
      const out = await storeInterpretation(bundle(), messages(), requestInterp(), "u1");
      expect(out.requestId).toBe("r1");
      const row = db.written("coach_requests", "upsert")[0] as Record<string, unknown>;
      expect(row).toMatchObject({
        user_id: "u1",
        person_id: "p1",
        status: "new",
        proposed_replaces_id: "r-2022",
        project_id: "pr1",
        bundle_id: "b1",
        understood: "Maren asked to replace the page 2 text.",
        open_question: { text: "Words or type?", options: ["Only words", "Type too"] },
      });
      expect(row.proposed_tasks).toHaveLength(3);
    });

    it("upserts on the bundle so a retry cannot create a second request", async () => {
      await storeInterpretation(bundle(), messages(), requestInterp(), "u1");
      const op = db.ops.find((o) => o.table === "coach_requests" && o.action === "upsert");
      expect(op?.options).toMatchObject({ onConflict: "bundle_id" });
    });

    it("stores a historical request as closed with no proposed tasks", async () => {
      await storeInterpretation(bundle({ historical: true }), messages(), requestInterp(), "u1");
      expect(db.written("coach_requests", "upsert")[0]).toMatchObject({
        status: "closed",
        historical: true,
        proposed_tasks: [],
        proposed_replaces_id: null,
      });
    });

    it("writes nothing for ordinary chat", async () => {
      const out = await storeInterpretation(bundle(), messagesWithTwoImages(), chatInterp(), "u1");
      expect(out.requestId).toBeNull();
      expect(db.writtenTables()).toEqual([]);
      expect(createImageClipMock).not.toHaveBeenCalled();
    });

    it("links a reply to the waiting ask and does not create a request", async () => {
      await storeInterpretation(bundle(), messages(), replyInterp("t-ask"), "u1");
      const op = db.ops.find((o) => o.table === "coach_tasks" && o.action === "update");
      expect(op?.payload).toEqual({ reply_bundle_id: "b1" });
      expect(eqValue(op!, "id")).toBe("t-ask");
      expect(eqValue(op!, "user_id")).toBe("u1");
      expect(db.writtenTables()).not.toContain("coach_requests");
    });

    it("creates a clip per attachment tagged with the project, and records the clip on the message", async () => {
      db = storeDb(bundle(), messagesWithTwoImages());
      await storeInterpretation(bundle(), messagesWithTwoImages(), requestInterp(), "u1");
      expect(createImageClipMock).toHaveBeenCalledTimes(2);
      expect(createImageClipMock).toHaveBeenCalledWith("u1", "coach/u1/a.png", [
        "project:alder-house",
      ]);
      const updates = db.written("coach_messages", "update") as {
        attachments: { clipId: string }[];
      }[];
      expect(updates).toHaveLength(2);
      expect(updates[0].attachments[0].clipId).toBe("clip-1");
    });

    it("still stores the request when a clip cannot be created", async () => {
      createImageClipMock.mockRejectedValue(new Error("Failed to save clip"));
      const out = await storeInterpretation(
        bundle(),
        messagesWithTwoImages(),
        requestInterp(),
        "u1",
      );
      expect(out.requestId).toBe("r1");
    });

    it("creates the project when the model names a new one, and puts the person on it", async () => {
      await storeInterpretation(
        bundle(),
        messages(),
        requestInterp({ projectId: null, newProjectName: "Studio prints" }),
        "u1",
      );
      expect(db.written("coach_projects", "insert")[0]).toMatchObject({
        user_id: "u1",
        name: "Studio prints",
        tag: "project:studio-prints",
      });
      expect(db.written("coach_project_people")[0]).toEqual({
        project_id: "pr-new",
        person_id: "p1",
      });
      expect(db.written("coach_requests", "upsert")[0]).toMatchObject({ project_id: "pr-new" });
    });
  });

  describe("the job", () => {
    it("interprets a collecting bundle and marks it done with its kind", async () => {
      interpretMock.mockResolvedValue(requestInterp());
      await run({ bundleId: "b1", userId: "u1" });
      expect(interpretMock).toHaveBeenCalledTimes(1);
      const updates = db.written("coach_bundles", "update");
      expect(updates[0]).toEqual({ status: "processing" });
      expect(updates.at(-1)).toEqual({ status: "done", kind: "request", fix_note: null });
    });

    it("passes the person, projects and the fix note to the interpreter", async () => {
      db = storeDb(bundle({ fix_note: "It's the homepage" }));
      interpretMock.mockResolvedValue(chatInterp());
      await run({ bundleId: "b1", userId: "u1" });
      const ctx = interpretMock.mock.calls[0][2];
      expect(ctx.person).toEqual({ id: "p1", name: "Maren" });
      expect(ctx.projects[0]).toMatchObject({ id: "pr1", name: "Alder House" });
      expect(ctx.fixNote).toBe("It's the homepage");
      expect(ctx.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("works out today's date in the user's timezone, not the server's", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-15T03:00:00Z")); // still the 14th in Los Angeles
      const inner = storeDb();
      db = makeDb((op: Op) =>
        op.table === "coach_settings"
          ? { data: { timezone: "America/Los_Angeles" } }
          : inner.respond(op),
      );
      interpretMock.mockResolvedValue(chatInterp());
      await run({ bundleId: "b1", userId: "u1" });
      vi.useRealTimers();
      expect(interpretMock.mock.calls[0][2].today).toBe("2026-11-14");
    });

    it("offers closed and historical requests as candidates to replace, but not replaced ones", async () => {
      interpretMock.mockResolvedValue(chatInterp());
      await run({ bundleId: "b1", userId: "u1" });
      const op = db.ops.find((o) => o.table === "coach_requests" && o.action === "select");
      expect(op?.filters).toContainEqual(["in", "status", ["new", "confirmed", "closed"]]);
    });

    it("retries when an attachment cannot be fetched, not reading the bundle without it", async () => {
      db = storeDb(bundle(), messagesWithTwoImages());
      downloadImage.mockRejectedValueOnce(new Error("storage hiccup"));
      interpretMock.mockResolvedValue(chatInterp());
      await expect(run({ bundleId: "b1", userId: "u1" }, 0)).rejects.toThrow("storage hiccup");
      expect(interpretMock).not.toHaveBeenCalled();
    });

    it("reads the bundle without a missing attachment only on the last attempt", async () => {
      db = storeDb(bundle(), messagesWithTwoImages());
      downloadImage.mockRejectedValueOnce(new Error("gone"));
      interpretMock.mockResolvedValue(chatInterp());
      await run({ bundleId: "b1", userId: "u1" }, 2);
      expect(downloadImage).toHaveBeenCalledTimes(2);
      expect(interpretMock.mock.calls[0][1]).toHaveLength(1);
    });

    it("tells the model the attachment's real type, not one guessed from the file name", async () => {
      db = storeDb(bundle(), [
        {
          ...messagesWithTwoImages()[0],
          attachments: [{ storagePath: "coach/u1/a.heic", mediaType: "image/heic" }],
        },
      ]);
      downloadImage.mockResolvedValue({ bytes: Buffer.from("x"), mediaType: "image/jpeg" });
      interpretMock.mockResolvedValue(chatInterp());
      await run({ bundleId: "b1", userId: "u1" });
      expect(interpretMock.mock.calls[0][1][0].mediaType).toBe("image/heic");
    });

    it("skips a bundle that is already done", async () => {
      db = storeDb(bundle({ status: "done" }));
      await run({ bundleId: "b1", userId: "u1" });
      expect(interpretMock).not.toHaveBeenCalled();
      expect(db.writtenTables()).toEqual([]);
    });

    it("reprocesses a bundle that failed before", async () => {
      db = storeDb(bundle({ status: "failed" }));
      interpretMock.mockResolvedValue(chatInterp());
      await run({ bundleId: "b1", userId: "u1" });
      expect(interpretMock).toHaveBeenCalledTimes(1);
    });

    // Review Focus 5: the model call fails or times out.
    it("lets an interpretation failure propagate so the job retries, deleting nothing", async () => {
      interpretMock.mockRejectedValue(new Error("timeout"));
      await expect(run({ bundleId: "b1", userId: "u1" })).rejects.toThrow("timeout");
      expect(db.ops.some((o) => o.action === "delete")).toBe(false);
      expect(db.writtenTables()).toEqual(["coach_bundles"]);
    });

    it("marks the bundle failed once retries are exhausted, counting the attempt", async () => {
      db = storeDb(bundle({ attempts: 1 }));
      await markBundleFailed("b1", "u1");
      const op = db.ops.find((o) => o.table === "coach_bundles" && o.action === "update");
      expect(op?.payload).toEqual({ status: "failed", attempts: 2 });
      expect(eqValue(op!, "id")).toBe("b1");
      expect(db.writtenTables()).toEqual(["coach_bundles"]);
    });
  });
});

describe("coach bundle job configuration", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Process bundle");
  });

  it("waits for quiet but never longer than 15 minutes, one bundle at a time per user", () => {
    expect(BUNDLE_JOB).toMatchObject({
      retries: 2,
      debounce: { key: "event.data.bundleId", period: "3m", timeout: "15m" },
      concurrency: [{ key: "event.data.userId", limit: 1 }],
      triggers: [{ event: "coach/bundle.touched" }],
    });
    expect(BUNDLE_JOB.onFailure).toEqual(expect.any(Function));
  });

  it("re-reads straight away for a fix or a sweep, still one at a time per user", () => {
    expect(RETRY_JOB).toMatchObject({
      retries: 2,
      concurrency: [{ key: "event.data.userId", limit: 1 }],
      triggers: [{ event: "coach/bundle.fix" }, { event: "coach/bundle.retry" }],
    });
    expect((RETRY_JOB as { debounce?: unknown }).debounce).toBeUndefined();
  });
});

describe("coach bundle sweep", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Process bundle");
    inngestSend.mockReset();
  });

  const sweep = () =>
    (sweepBundles as unknown as (a: unknown) => Promise<{ resent: number }>)({
      step: { run: async (_n: string, fn: () => Promise<unknown>) => fn() },
    });

  it("re-announces bundles that were never read and failed ones that still have attempts left", async () => {
    db = makeDb((op: Op) => {
      if (op.table !== "coach_bundles") return undefined;
      return eqValue(op, "status") === "collecting"
        ? { data: [{ id: "b-stuck", user_id: "u1" }] }
        : { data: [{ id: "b-failed", user_id: "u2" }] };
    });
    const out = await sweep();
    expect(out.resent).toBe(2);
    expect(inngestSend).toHaveBeenCalledWith({
      name: "coach/bundle.retry",
      data: { bundleId: "b-stuck", userId: "u1" },
    });
    expect(inngestSend).toHaveBeenCalledWith({
      name: "coach/bundle.retry",
      data: { bundleId: "b-failed", userId: "u2" },
    });
  });

  it("only picks up bundles quiet for a while, and gives up on a bundle after 3 failures", async () => {
    db = makeDb(() => ({ data: [] }));
    await sweep();
    const [stuck, failed] = db.ops;
    expect(stuck.filters).toContainEqual(["eq", "status", "collecting"]);
    expect(stuck.filters.some(([m, c]) => m === "lt" && c === "last_message_at")).toBe(true);
    expect(failed.filters).toContainEqual(["eq", "status", "failed"]);
    expect(failed.filters).toContainEqual(["lt", "attempts", 3]);
  });

  it("does nothing when there is nothing to sweep", async () => {
    db = makeDb(() => ({ data: [] }));
    expect((await sweep()).resent).toBe(0);
    expect(inngestSend).not.toHaveBeenCalled();
  });
});
