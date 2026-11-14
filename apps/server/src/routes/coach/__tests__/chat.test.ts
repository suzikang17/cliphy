import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import { makeDb, eqValue, passAuth, passCoach, json, type FakeDb, type Op } from "./helpers.js";

let db: FakeDb;
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../../lib/storage.js", () => ({
  signImageUrl: vi.fn(async (p: string) => `https://signed/${p}`),
}));
const inngestSend = vi.fn();
vi.mock("../../../lib/inngest.js", () => ({
  inngest: { send: (...a: unknown[]) => inngestSend(...a) },
}));
const syncMock = vi.fn();
vi.mock("../../../services/coach/reminders.js", async (orig) => ({
  ...(await orig<typeof import("../../../services/coach/reminders.js")>()),
  syncTaskReminders: (...a: unknown[]) => syncMock(...a),
}));
vi.mock("../../../middleware/auth.js", () => passAuth);
vi.mock("../../../middleware/require-coach.js", () => passCoach);

const { coachRoutes } = await import("../index.js");
const { postBotMessage } = await import("../../../services/coach/chat.js");
const { taskUnblocked } = await import("../../../services/coach/botMessages.js");
const app = () => new Hono().route("/api/coach", coachRoutes);
const post = (path: string, body: unknown = {}) => app().request(path, json("POST", body));

const taskRow = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  kind: "do",
  state: "open",
  title: "Homepage photo swap",
  kit: {},
  checklist: [],
  after_task_id: null,
  due_date: "2026-11-18",
  created_at: "2026-11-14T09:00:00Z",
  ...over,
});
const messageRow = (buttons: unknown[], over: Record<string, unknown> = {}) => ({
  id: "m1",
  role: "bot",
  text: "Homepage photo swap. Maren asked for this by today.",
  attachments: [],
  buttons,
  link: null,
  chosen: null,
  kind: "reminder",
  created_at: "2026-11-14T17:00:00Z",
  ...over,
});

interface World {
  message?: Record<string, unknown> | null;
  /** What the guarded "claim this tap" update returns; null = already tapped. */
  claimed?: boolean;
  tasks?: Record<string, unknown>[];
  thread?: Record<string, unknown>[];
  rules?: Record<string, unknown>[];
}
function world(w: World = {}) {
  const tasks = w.tasks ?? [taskRow()];
  return makeDb((op: Op) => {
    if (op.table === "coach_chat_messages") {
      if (op.action === "select")
        return op.single ? { data: w.message ?? null } : { data: w.thread ?? [] };
      if (op.action === "update")
        return { data: w.claimed === false ? null : { ...w.message, ...(op.payload as object) } };
      return { data: [{ id: "new-msg" }] };
    }
    if (op.table === "coach_tasks") {
      if (op.action === "update") {
        const row = tasks.find((t) => t.id === eqValue(op, "id"));
        return { data: row ? { ...row, ...(op.payload as object) } : null };
      }
      return op.single
        ? { data: tasks.find((t) => t.id === eqValue(op, "id")) ?? null }
        : { data: tasks };
    }
    if (op.table === "coach_rules") {
      if (op.action === "select") return { data: w.rules ?? [] };
      return {
        data: (w.rules ?? [])[0] ? { ...(w.rules ?? [])[0], ...(op.payload as object) } : null,
      };
    }
    if (op.table === "coach_settings") return { data: { timezone: "America/Los_Angeles" } };
    return { data: [] };
  });
}
const chosenUpdates = () =>
  db.ops
    .filter((o) => o.table === "coach_chat_messages" && o.action === "update")
    .map((o) => o.payload);
const posted = () =>
  db
    .written("coach_chat_messages")
    .filter((p) => (p as { role?: string }).role === "bot") as Record<string, unknown>[];

describe("coach chat", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Chat");
    inngestSend.mockReset();
    syncMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T18:00:00Z")); // Saturday 10:00 in LA
    db = world();
  });
  afterEach(() => vi.useRealTimers());

  // Review Focus 1: a job retries after posting.
  it("posts a message about one thing only once", async () => {
    await postBotMessage(
      "u1",
      taskUnblocked({ id: "t2", kind: "do", title: "Replace page 2 copy" }),
    );
    const op = db.ops.find((o) => o.table === "coach_chat_messages")!;
    expect(op.action).toBe("upsert");
    expect(op.options).toMatchObject({ onConflict: "user_id,kind,ref_id", ignoreDuplicates: true });
    expect(op.payload).toMatchObject({
      user_id: "u1",
      role: "bot",
      kind: "unblocked",
      ref_id: "t2",
      text: "Replace page 2 copy is ready.",
    });
  });

  it("fails loudly when a message cannot be saved, instead of looking already said", async () => {
    db = makeDb(() => ({ data: null, error: { message: "boom" } }));
    await expect(
      postBotMessage("u1", taskUnblocked({ id: "t2", kind: "do", title: "x" })),
    ).rejects.toThrow(/save/i);
  });

  it("returns null when that message was already in the thread", async () => {
    db = makeDb(() => ({ data: [] }));
    expect(
      await postBotMessage("u1", taskUnblocked({ id: "t2", kind: "do", title: "x" })),
    ).toBeNull();
  });

  it("lists the thread oldest first, newer than a given time", async () => {
    db = world({ thread: [messageRow([])] });
    const res = await app().request("/api/coach/chat?after=2026-11-14T00:00:00Z");
    expect((await res.json()).messages[0]).toMatchObject({ id: "m1", role: "bot", chosen: null });
    const q = db.ops[0];
    expect(q.filters).toContainEqual(["eq", "user_id", "test-user-id"]);
    expect(q.filters).toContainEqual(["gt", "created_at", "2026-11-14T00:00:00Z"]);
  });

  it("returns what the bot is doing right now alongside the thread", async () => {
    const inner = world({ thread: [messageRow([])] });
    db = makeDb((op: Op) => {
      if (op.table === "coach_bundles") {
        return {
          data: [
            {
              person_id: "p1",
              status: "collecting",
              last_message_at: "2026-11-14T17:58:00Z",
              historical: false,
            },
          ],
        };
      }
      if (op.table === "coach_people") return { data: [{ id: "p1", name: "Maren" }] };
      return inner.respond(op);
    });
    const res = await app().request("/api/coach/chat");
    expect((await res.json()).activity).toEqual(["Reading Maren's message"]);
  });

  it("gives each attachment in the thread a link the phone can show", async () => {
    db = world({
      thread: [
        messageRow([], {
          attachments: [{ storagePath: "coach/test-user-id/a.png", mediaType: "image/png" }],
        }),
      ],
    });
    const { messages } = await (await app().request("/api/coach/chat")).json();
    expect(messages[0].attachments[0].url).toBe("https://signed/coach/test-user-id/a.png");
  });

  it("returns no activity when the bot is idle", async () => {
    db = world({ thread: [messageRow([])] });
    expect((await (await app().request("/api/coach/chat")).json()).activity).toEqual([]);
  });

  it("stores what the user typed and hands it to the bot", async () => {
    const res = await post("/api/coach/chat", {
      text: "  Only the words. Remind me tomorrow morning.  ",
    });
    expect(res.status).toBe(202);
    expect(db.written("coach_chat_messages")[0]).toMatchObject({
      user_id: "test-user-id",
      role: "user",
      kind: "user",
      text: "Only the words. Remind me tomorrow morning.",
    });
    expect(inngestSend).toHaveBeenCalledWith({
      name: "coach/chat.message",
      data: { userId: "test-user-id", messageId: "new-msg" },
    });
  });

  it("rejects an empty message", async () => {
    expect((await post("/api/coach/chat", { text: "   " })).status).toBe(400);
  });

  it("marks a task done from a button, records the tap, and says so", async () => {
    db = world({
      message: messageRow([
        { label: "Done", action: { type: "task_state", taskId: "t1", state: "done" } },
      ]),
    });
    const res = await post("/api/coach/chat/m1/choose", { index: 0 });
    const body = await res.json();
    expect(body.message.chosen).toBe(0);
    expect(body.did).toBe("Done.");

    const claim = db.ops.find((o) => o.table === "coach_chat_messages" && o.action === "update")!;
    expect(claim.payload).toEqual({ chosen: 0 });
    expect(claim.filters).toContainEqual(["is", "chosen", null]);
    expect(claim.filters).toContainEqual(["eq", "user_id", "test-user-id"]);

    const upd = db.ops.find((o) => o.table === "coach_tasks" && o.action === "update")!;
    expect(upd.payload).toMatchObject({ state: "done", done_at: expect.any(String) });
    expect(syncMock).toHaveBeenCalledWith("test-user-id", ["t1"]);
    expect(posted().at(-1)).toMatchObject({ kind: "did", text: "Done." });
  });

  // Review Focus 2: tapped twice.
  it("does nothing on a second tap", async () => {
    db = world({
      message: messageRow(
        [{ label: "Done", action: { type: "task_state", taskId: "t1", state: "done" } }],
        { chosen: 0 },
      ),
      claimed: false,
    });
    const res = await post("/api/coach/chat/m1/choose", { index: 0 });
    expect(res.status).toBe(200);
    expect((await res.json()).did).toBeNull();
    expect(db.ops.some((o) => o.table === "coach_tasks" && o.action === "update")).toBe(false);
  });

  // Review Focus 2: the action is no longer valid.
  it("records the tap but changes nothing when the task is no longer the user's to change", async () => {
    db = world({
      message: messageRow([
        { label: "Done", action: { type: "task_state", taskId: "gone", state: "done" } },
      ]),
      tasks: [],
    });
    const res = await post("/api/coach/chat/m1/choose", { index: 0 });
    expect(res.status).toBe(200);
    expect((await res.json()).did).toBeNull();
    expect(posted()).toEqual([]);
  });

  it("says a waiting task is ready when the task it waited for is finished", async () => {
    db = world({
      message: messageRow([
        { label: "Done", action: { type: "task_state", taskId: "t1", state: "done" } },
      ]),
      tasks: [
        taskRow(),
        taskRow({
          id: "t2",
          kind: "tell",
          title: "Tell Maren it's live",
          after_task_id: "t1",
          due_date: null,
        }),
      ],
    });
    await post("/api/coach/chat/m1/choose", { index: 0 });
    expect(posted()).toContainEqual(
      expect.objectContaining({
        kind: "unblocked",
        ref_id: "t2",
        text: "Tell Maren it's live is ready.",
      }),
    );
  });

  it("moves a task to tomorrow and re-plans its reminders", async () => {
    db = world({
      message: messageRow([
        { label: "Tomorrow", action: { type: "snooze", taskId: "t1", days: 1 } },
      ]),
      tasks: [taskRow({ due_date: "2026-11-14" })],
    });
    const res = await post("/api/coach/chat/m1/choose", { index: 0 });
    expect((await res.json()).did).toBe("Moved to Sunday.");
    const upd = db.ops.find((o) => o.table === "coach_tasks" && o.action === "update")!;
    expect(upd.payload).toEqual({ due_date: "2026-11-15" });
    expect(syncMock).toHaveBeenCalledWith("test-user-id", ["t1"]);
  });

  it("snoozes an overdue task from today, not from its old date", async () => {
    db = world({
      message: messageRow([
        { label: "Tomorrow", action: { type: "snooze", taskId: "t1", days: 1 } },
      ]),
      tasks: [taskRow({ due_date: "2026-11-10" })],
    });
    await post("/api/coach/chat/m1/choose", { index: 0 });
    const upd = db.ops.find((o) => o.table === "coach_tasks" && o.action === "update")!;
    expect(upd.payload).toEqual({ due_date: "2026-11-15" });
  });

  it("closes a waiting ask", async () => {
    db = world({
      message: messageRow([{ label: "Close", action: { type: "close_ask", taskId: "a1" } }]),
      tasks: [taskRow({ id: "a1", kind: "ask", state: "waiting" })],
    });
    const res = await post("/api/coach/chat/m1/choose", { index: 0 });
    expect((await res.json()).did).toBe("Closed.");
    expect(
      db.ops.find((o) => o.table === "coach_tasks" && o.action === "update")!.payload,
    ).toMatchObject({ state: "done" });
  });

  it("forgets a rule on Undo", async () => {
    db = world({
      message: messageRow([{ label: "Undo", action: { type: "undo_rule", ruleId: "rule1" } }], {
        kind: "rule",
      }),
      rules: [{ id: "rule1", sentence: "x", active: true }],
    });
    const res = await post("/api/coach/chat/m1/choose", { index: 0 });
    expect((await res.json()).did).toBe("Forgotten.");
    const upd = db.ops.find((o) => o.table === "coach_rules" && o.action === "update")!;
    expect(upd.payload).toEqual({ active: false });
    expect(upd.filters).toContainEqual(["eq", "user_id", "test-user-id"]);
  });

  it("asks what was wrong when Fix it is tapped, leaving Looks right still tappable", async () => {
    db = world({
      message: messageRow([{ label: "Fix it", action: { type: "fix_request", requestId: "r1" } }], {
        kind: "request",
      }),
    });
    const res = await post("/api/coach/chat/m1/choose", { index: 0 });
    const body = await res.json();
    expect(body.did).toBe("What did I get wrong?");
    expect(body.message.chosen).toBeNull();
    expect(chosenUpdates().at(-1)).toEqual({ chosen: null });
  });

  it("frees the button and says so when the action could not be done", async () => {
    // Done on a task that is still waiting on another.
    db = world({
      message: messageRow([
        { label: "Done", action: { type: "task_state", taskId: "t2", state: "done" } },
      ]),
      tasks: [taskRow(), taskRow({ id: "t2", after_task_id: "t1" })],
    });
    const res = await post("/api/coach/chat/m1/choose", { index: 0 });
    const body = await res.json();
    expect(body.did).toBe("That is still waiting on something.");
    expect(body.message.chosen).toBeNull();
    expect(chosenUpdates().at(-1)).toEqual({ chosen: null });
  });

  it("frees the button and says so when the action throws", async () => {
    const inner = world({
      message: messageRow([
        { label: "Done", action: { type: "task_state", taskId: "t1", state: "done" } },
      ]),
    });
    db = makeDb((op: Op) => {
      if (op.table === "coach_tasks" && op.action === "update") throw new Error("db down");
      return inner.respond(op);
    });
    const res = await post("/api/coach/chat/m1/choose", { index: 0 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.did).toBe("That didn't work. Try again.");
    expect(body.message.chosen).toBeNull();
  });

  it("records a tap that only opens something, without a message", async () => {
    db = world({
      message: messageRow([
        { label: "Start", action: { type: "open", link: { type: "task", id: "t1" } } },
      ]),
    });
    const res = await post("/api/coach/chat/m1/choose", { index: 0 });
    expect((await res.json()).did).toBeNull();
    expect(posted()).toEqual([]);
  });

  it("404s a message that is not the caller's and 400s a button that does not exist", async () => {
    db = world({ message: null });
    expect((await post("/api/coach/chat/nope/choose", { index: 0 })).status).toBe(404);
    db = world({ message: messageRow([]) });
    expect((await post("/api/coach/chat/m1/choose", { index: 2 })).status).toBe(400);
  });

  it("returns Up next computed for the user's own date", async () => {
    db = world({
      tasks: [taskRow({ due_date: "2026-11-14" }), taskRow({ id: "old", due_date: "2026-11-13" })],
    });
    const res = await app().request("/api/coach/upnext");
    const up = await res.json();
    // 18:00Z is still Saturday the 14th in Los Angeles.
    expect(up.thisWeek[0].date).toBe("2026-11-14");
    expect(up.overdue.map((t: { id: string }) => t.id)).toEqual(["old"]);
  });

  it("lists, edits and deletes learned rules, always scoped to the caller", async () => {
    db = world({
      rules: [
        {
          id: "rule1",
          sentence: "Photos of frames go to Studio prints.",
          active: true,
          created_at: "x",
        },
      ],
    });
    const list = await (await app().request("/api/coach/rules")).json();
    expect(list.rules[0]).toMatchObject({ id: "rule1", active: true });

    const res = await app().request(
      "/api/coach/rules/rule1",
      json("PATCH", { sentence: " Frames go to Studio prints. " }),
    );
    expect(res.status).toBe(200);
    const upd = db.ops.find((o) => o.table === "coach_rules" && o.action === "update")!;
    expect(upd.payload).toEqual({ sentence: "Frames go to Studio prints." });
    expect(upd.filters).toContainEqual(["eq", "user_id", "test-user-id"]);

    await app().request("/api/coach/rules/rule1", json("DELETE"));
    const del = db.ops.find((o) => o.table === "coach_rules" && o.action === "delete")!;
    expect(del.filters).toContainEqual(["eq", "user_id", "test-user-id"]);
  });

  it("rejects an empty rule", async () => {
    db = world({ rules: [{ id: "rule1", sentence: "x", active: true }] });
    const res = await app().request("/api/coach/rules/rule1", json("PATCH", { sentence: "  " }));
    expect(res.status).toBe(400);
  });
});
