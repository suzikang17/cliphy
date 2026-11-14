import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import type { CoachTask } from "@cliphy/shared";
import { makeDb, eqValue, passAuth, passCoach, json, type FakeDb, type Op } from "./helpers.js";

let db: FakeDb;
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../../lib/storage.js", () => ({ signImageUrl: vi.fn() }));
vi.mock("../../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));
const syncMock = vi.fn();
vi.mock("../../../services/coach/reminders.js", () => ({
  syncTaskReminders: (...a: unknown[]) => syncMock(...a),
}));
vi.mock("../../../middleware/auth.js", () => passAuth);
vi.mock("../../../middleware/require-coach.js", () => passCoach);

const { coachRoutes } = await import("../index.js");
const app = () => new Hono().route("/api/coach", coachRoutes);
const post = (path: string, body: unknown) => app().request(path, json("POST", body));
const patch = (path: string, body: unknown) => app().request(path, json("PATCH", body));

const taskRow = (over: Record<string, unknown> = {}) => ({
  id: "t",
  kind: "do",
  state: "open",
  title: "Replace page 2 copy",
  kit: {},
  checklist: [],
  after_task_id: null,
  position: 0,
  created_at: "2026-11-14T09:44:00Z",
  ...over,
});

/** A database holding `rows` as the user's tasks. Writes echo the changed row back. */
function taskDb(rows: Record<string, unknown>[]) {
  return makeDb((op: Op) => {
    if (op.table !== "coach_tasks") return { data: { id: "ok" } };
    if (op.action === "insert")
      return { data: { ...taskRow(), id: "new", ...(op.payload as object) } };
    if (op.action === "update") {
      const row = rows.find((r) => r.id === eqValue(op, "id"));
      return { data: row ? { ...row, ...(op.payload as object) } : null };
    }
    return op.single
      ? { data: rows.find((r) => r.id === eqValue(op, "id")) ?? null }
      : { data: rows };
  });
}

const updated = () =>
  db.ops.find((o) => o.table === "coach_tasks" && o.action === "update")?.payload as
    | Record<string, unknown>
    | undefined;

describe("coach tasks", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Tasks");
    syncMock.mockReset();
    db = taskDb([]);
  });

  it("lists open tasks with blocked computed from the predecessor", async () => {
    db = taskDb([
      taskRow({ id: "a", kind: "ask", state: "waiting" }),
      taskRow({ id: "b", kind: "do", state: "open", after_task_id: "a" }),
    ]);
    const { tasks } = await (await app().request("/api/coach/tasks")).json();
    expect(tasks.find((t: CoachTask) => t.id === "b").blocked).toBe(true);
    expect(tasks.find((t: CoachTask) => t.id === "a").blocked).toBe(false);
  });

  it("leaves finished and dropped tasks out unless a state is asked for", async () => {
    db = taskDb([
      taskRow({ id: "a", state: "done" }),
      taskRow({ id: "b", state: "open", after_task_id: "a" }),
      taskRow({ id: "c", state: "dropped" }),
    ]);
    const { tasks } = await (await app().request("/api/coach/tasks")).json();
    expect(tasks.map((t: CoachTask) => t.id)).toEqual(["b"]);
    expect(tasks[0].blocked).toBe(false);
    const done = await (await app().request("/api/coach/tasks?state=done")).json();
    expect(done.tasks.map((t: CoachTask) => t.id)).toEqual(["a"]);
  });

  it("orders by due date, undated last", async () => {
    db = taskDb([
      taskRow({ id: "undated", position: 0 }),
      taskRow({ id: "wed", due_date: "2026-11-18" }),
      taskRow({ id: "sun", due_date: "2026-11-15" }),
    ]);
    const { tasks } = await (await app().request("/api/coach/tasks")).json();
    expect(tasks.map((t: CoachTask) => t.id)).toEqual(["sun", "wed", "undated"]);
  });

  it("filters by project", async () => {
    await app().request("/api/coach/tasks?projectId=pr1");
    expect(db.ops[0].filters).toContainEqual(["eq", "user_id", "test-user-id"]);
    db = taskDb([taskRow({ id: "a", project_id: "pr1" }), taskRow({ id: "b", project_id: "pr2" })]);
    const { tasks } = await (await app().request("/api/coach/tasks?projectId=pr1")).json();
    expect(tasks.map((t: CoachTask) => t.id)).toEqual(["a"]);
  });

  it("rejects an unknown state filter", async () => {
    expect((await app().request("/api/coach/tasks?state=banana")).status).toBe(400);
  });

  it("creates an errand with a place and checklist", async () => {
    const res = await post("/api/coach/tasks", {
      kind: "get",
      title: " Framing supplies ",
      place: "Art store",
      checklist: [
        { text: "Mat board", done: false },
        { text: "Hanging wire", done: false },
      ],
    });
    expect(res.status).toBe(201);
    expect(db.written("coach_tasks", "insert")[0]).toMatchObject({
      user_id: "test-user-id",
      kind: "get",
      title: "Framing supplies",
      place: "Art store",
      checklist: [
        { text: "Mat board", done: false },
        { text: "Hanging wire", done: false },
      ],
    });
  });

  it("creates a dated task of the user's own", async () => {
    const res = await post("/api/coach/tasks", {
      kind: "do",
      title: "Frame the print",
      dueDate: "2026-11-20",
      dueTime: "09:00",
    });
    expect(res.status).toBe(201);
    expect(db.written("coach_tasks", "insert")[0]).toMatchObject({
      due_date: "2026-11-20",
      due_time: "09:00",
      request_id: null,
    });
  });

  it("rejects a place on a task that is not an errand", async () => {
    const res = await post("/api/coach/tasks", { kind: "do", title: "x", place: "Art store" });
    expect(res.status).toBe(400);
  });

  it("rejects a time without a date", async () => {
    expect(
      (await post("/api/coach/tasks", { kind: "do", title: "x", dueTime: "09:00" })).status,
    ).toBe(400);
  });

  it("rejects a malformed date or time, an unknown kind and an empty title", async () => {
    const bad = [
      { kind: "do", title: "x", dueDate: "next week" },
      { kind: "do", title: "x", dueDate: "2026-13-45" },
      { kind: "do", title: "x", dueDate: "2026-11-20", dueTime: "9am" },
      { kind: "dance", title: "x" },
      { kind: "do", title: "  " },
    ];
    for (const body of bad) expect((await post("/api/coach/tasks", body)).status).toBe(400);
    expect(db.writtenTables()).toEqual([]);
  });

  it("sent moves an ask to waiting", async () => {
    db = taskDb([taskRow({ id: "a", kind: "ask" })]);
    const res = await post("/api/coach/tasks/a/sent", {});
    expect(updated()).toMatchObject({ state: "waiting" });
    expect((await res.json()).task.state).toBe("waiting");
  });

  it("sent finishes a tell", async () => {
    db = taskDb([taskRow({ id: "t1", kind: "tell" })]);
    await post("/api/coach/tasks/t1/sent", {});
    expect(updated()).toMatchObject({ state: "done" });
    expect(updated()?.done_at).toEqual(expect.any(String));
  });

  it("sent refuses a do task", async () => {
    db = taskDb([taskRow({ id: "d", kind: "do" })]);
    expect((await post("/api/coach/tasks/d/sent", {})).status).toBe(400);
    expect(updated()).toBeUndefined();
  });

  it("refuses to complete a blocked task", async () => {
    db = taskDb([
      taskRow({ id: "a", kind: "ask", state: "waiting" }),
      taskRow({ id: "b", kind: "do", after_task_id: "a" }),
    ]);
    expect((await patch("/api/coach/tasks/b", { state: "done" })).status).toBe(409);
    expect(updated()).toBeUndefined();
  });

  it("refuses waiting through a plain update", async () => {
    db = taskDb([taskRow({ id: "a", kind: "ask" })]);
    expect((await patch("/api/coach/tasks/a", { state: "waiting" })).status).toBe(400);
  });

  it("stamps done_at when a task is completed and clears it when reopened", async () => {
    db = taskDb([taskRow({ id: "d" })]);
    await patch("/api/coach/tasks/d", { state: "done" });
    expect(updated()?.done_at).toEqual(expect.any(String));

    db = taskDb([taskRow({ id: "d", state: "done", done_at: "2026-11-14T10:00:00Z" })]);
    await patch("/api/coach/tasks/d", { state: "open" });
    expect(updated()).toMatchObject({ state: "open", done_at: null });
  });

  it("ticks a single checklist item on an errand", async () => {
    db = taskDb([taskRow({ id: "g", kind: "get" })]);
    await patch("/api/coach/tasks/g", {
      checklist: [
        { text: "Mat board", done: true },
        { text: "Hanging wire", done: false },
      ],
    });
    expect(updated()?.checklist).toEqual([
      { text: "Mat board", done: true },
      { text: "Hanging wire", done: false },
    ]);
  });

  it("clears a date, and its time with it", async () => {
    db = taskDb([taskRow({ id: "d", due_date: "2026-11-20", due_time: "09:00" })]);
    await patch("/api/coach/tasks/d", { dueDate: null });
    expect(updated()).toMatchObject({ due_date: null, due_time: null });
  });

  it("schedules reminders for a new dated task", async () => {
    await post("/api/coach/tasks", { kind: "do", title: "Frame the print", dueDate: "2026-11-20" });
    expect(syncMock).toHaveBeenCalledWith("test-user-id", ["new"]);
  });

  it("re-syncs reminders when a task's date, time or state changes", async () => {
    db = taskDb([taskRow({ id: "d", due_date: "2026-11-20" })]);
    await patch("/api/coach/tasks/d", { dueDate: "2026-11-22" });
    await patch("/api/coach/tasks/d", { state: "done" });
    expect(syncMock).toHaveBeenCalledTimes(2);
    expect(syncMock).toHaveBeenCalledWith("test-user-id", ["d"]);
  });

  it("does not touch reminders when only the title changes", async () => {
    db = taskDb([taskRow({ id: "d", due_date: "2026-11-20" })]);
    await patch("/api/coach/tasks/d", { title: "New title" });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("re-syncs reminders when a message is sent", async () => {
    db = taskDb([taskRow({ id: "t1", kind: "tell", due_date: "2026-11-20" })]);
    await post("/api/coach/tasks/t1/sent", {});
    expect(syncMock).toHaveBeenCalledWith("test-user-id", ["t1"]);
  });

  it("says the next step is ready when a task is finished", async () => {
    db = taskDb([
      taskRow({ id: "a", kind: "do" }),
      taskRow({ id: "b", kind: "tell", title: "Tell Maren it's live", after_task_id: "a" }),
    ]);
    await patch("/api/coach/tasks/a", { state: "done" });
    expect(db.written("coach_chat_messages")[0]).toMatchObject({
      kind: "unblocked",
      ref_id: "b",
      text: "Tell Maren it's live is ready.",
    });
  });

  it("says the next step is ready when a message is sent", async () => {
    db = taskDb([
      taskRow({ id: "t1", kind: "tell" }),
      taskRow({ id: "after", kind: "do", title: "Archive the old copy", after_task_id: "t1" }),
    ]);
    await post("/api/coach/tasks/t1/sent", {});
    expect(db.written("coach_chat_messages")[0]).toMatchObject({
      kind: "unblocked",
      ref_id: "after",
    });
  });

  it("does not announce anything when the finished task had nothing waiting on it", async () => {
    db = taskDb([taskRow({ id: "a" })]);
    await patch("/api/coach/tasks/a", { state: "done" });
    expect(db.written("coach_chat_messages")).toEqual([]);
  });

  it("404s a task that is not the caller's", async () => {
    expect((await patch("/api/coach/tasks/nope", { title: "x" })).status).toBe(404);
    expect((await post("/api/coach/tasks/nope/sent", {})).status).toBe(404);
  });
});
