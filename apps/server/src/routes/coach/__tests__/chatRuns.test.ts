import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import { makeDb, eqValue, passAuth, passCoach, json, type FakeDb, type Op } from "./helpers.js";

let db: FakeDb;
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../../lib/storage.js", () => ({ signImageUrl: vi.fn(async () => null) }));
vi.mock("../../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));
vi.mock("../../../services/coach/reminders.js", async (orig) => ({
  ...(await orig<typeof import("../../../services/coach/reminders.js")>()),
  syncTaskReminders: vi.fn(),
}));
const confirmMock = vi.fn();
vi.mock("../../../services/coach/requestActions.js", async (orig) => ({
  ...(await orig<typeof import("../../../services/coach/requestActions.js")>()),
  confirmRequest: (...a: unknown[]) => confirmMock(...a),
}));
vi.mock("../../../middleware/auth.js", () => passAuth);
vi.mock("../../../middleware/require-coach.js", () => passCoach);

const { coachRoutes } = await import("../index.js");
const app = () => new Hono().route("/api/coach", coachRoutes);
const tap = () => app().request("/api/coach/chat/m1/choose", json("POST", { index: 0 }));

const taskRow = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  project_id: "pr1",
  kind: "do",
  state: "open",
  title: "Move the sconces up on page 2",
  kit: {},
  after_task_id: null,
  created_at: "2026-11-14T09:00:00Z",
  ...over,
});
const runRow = (over: Record<string, unknown> = {}) => ({
  id: "run1",
  task_id: "t1",
  status: "queued",
  pictures: [],
  created_at: "2026-11-15T09:00:00Z",
  ...over,
});

interface World {
  button: unknown;
  tasks?: Record<string, unknown>[];
  repo?: string | null;
  /** What inserting or cancelling a run returns. */
  run?: Record<string, unknown> | null;
  requestStatus?: string;
}
function world(w: World) {
  const tasks = w.tasks ?? [taskRow()];
  const project = { id: "pr1", repo: w.repo === undefined ? "example/alder-house" : w.repo };
  const message = {
    id: "m1",
    role: "bot",
    buttons: [{ label: "x", action: w.button }],
    chosen: null,
  };
  return makeDb((op: Op) => {
    if (op.table === "coach_chat_messages") {
      if (op.action === "select") return { data: message };
      if (op.action === "update") return { data: { ...message, ...(op.payload as object) } };
      return { data: [{ id: "new" }] };
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
    if (op.table === "coach_projects") return { data: op.single ? project : [project] };
    if (op.table === "coach_runs") return { data: w.run === undefined ? runRow() : w.run };
    if (op.table === "coach_requests") return { data: { status: w.requestStatus ?? "new" } };
    if (op.table === "coach_settings") return { data: { timezone: "America/Los_Angeles" } };
    return { data: [] };
  });
}
const posted = () =>
  db
    .written("coach_chat_messages")
    .filter((p) => (p as { role?: string }).role === "bot") as Record<string, unknown>[];
const startButton = { label: "Start on the site", action: { type: "start_run", taskId: "t1" } };
const confirmedWith = (tasks: Record<string, unknown>[]) =>
  confirmMock.mockResolvedValue({ status: 200, body: { request: {}, tasks } });
const chainTask = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  projectId: "pr1",
  kind: "do",
  state: "open",
  blocked: false,
  title: "Move the sconces up on page 2",
  ...over,
});

describe("starting work on the site from Chat", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Runner");
    confirmMock.mockReset();
  });

  describe("after a request is confirmed", () => {
    const confirm = { type: "confirm_request", requestId: "r1" };

    it("offers Start on the site when its work can start there now", async () => {
      db = world({ button: confirm });
      confirmedWith([chainTask({ id: "t0", kind: "tell" }), chainTask()]);
      await tap();
      expect(posted().at(-1)).toMatchObject({
        kind: "did",
        text: "Saved. 2 tasks added.",
        buttons: [startButton],
      });
    });

    it("offers nothing while that work is waiting on something else", async () => {
      db = world({ button: confirm });
      confirmedWith([chainTask({ blocked: true })]);
      await tap();
      expect(posted().at(-1)).toMatchObject({ text: "Saved. 1 task added.", buttons: [] });
    });

    it("offers nothing when the project has no website repo", async () => {
      db = world({ button: confirm, repo: null });
      confirmedWith([chainTask()]);
      await tap();
      expect(posted().at(-1)).toMatchObject({ buttons: [] });
    });
  });

  it("offers Start on the site when the work it waited for is finished", async () => {
    db = world({
      button: { type: "task_state", taskId: "t0", state: "done" },
      tasks: [taskRow({ id: "t0", kind: "ask" }), taskRow({ after_task_id: "t0" })],
    });
    await tap();
    const ready = posted().find((m) => m.kind === "unblocked")!;
    expect((ready.buttons as { label: string }[]).map((b) => b.label)).toEqual([
      "Start",
      "Start on the site",
    ]);
  });

  it("queues a run on the tap and says it started, once per run", async () => {
    db = world({ button: startButton.action });
    const body = await (await tap()).json();
    expect(body.did).toBeNull();
    expect(db.written("coach_runs", "insert")).toEqual([
      { user_id: "test-user-id", task_id: "t1" },
    ]);
    expect(posted()).toEqual([
      expect.objectContaining({
        kind: "run_started",
        ref_id: "run1",
        text: 'Started on the site: "Move the sconces up on page 2"',
        buttons: [{ label: "Stop", action: { type: "stop_run", runId: "run1" } }],
      }),
    ]);
  });

  it("says so and gives the button back when the task can no longer be started there", async () => {
    db = world({ button: startButton.action, tasks: [taskRow({ state: "done" })] });
    const body = await (await tap()).json();
    expect(body.did).toBe("That task can't be started on the site.");
    expect(body.message.chosen).toBeNull();
    expect(db.written("coach_runs")).toEqual([]);
  });

  it("stops a run on Stop and says so, once per run", async () => {
    db = world({
      button: { type: "stop_run", runId: "run1" },
      run: runRow({ status: "cancelled" }),
    });
    await tap();
    expect(db.written("coach_runs", "update")[0]).toMatchObject({ status: "cancelled" });
    expect(posted()).toEqual([
      expect.objectContaining({ kind: "run_finished", ref_id: "run1", text: "Stopped." }),
    ]);
  });

  it("a button cannot be tapped with an API key: only the signed-in phone starts work", async () => {
    db = world({ button: startButton.action });
    passAuth.authMiddleware.mockImplementationOnce(async (c, next) => {
      c.set("userId", "test-user-id");
      c.set("authMethod", "api_key");
      await next();
    });
    const res = await tap();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Sign in on the phone to do this" });
    expect(db.ops).toEqual([]);
  });

  it("still queues the run when the started message could not be saved", async () => {
    db = world({ button: startButton.action });
    db.respond = ((inner) => (op: Op) =>
      op.table === "coach_chat_messages" && op.action === "upsert"
        ? { data: null, error: { message: "down" } }
        : inner(op))(db.respond);
    const body = await (await tap()).json();
    expect(db.written("coach_runs", "insert")).toHaveLength(1);
    expect(body.did).toBeNull(); // Not "That didn't work": the run is going.
    expect(body.message.chosen).toBe(0);
  });
});
