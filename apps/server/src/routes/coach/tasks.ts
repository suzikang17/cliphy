import { Hono } from "hono";
import { TASK_STATES, type TaskKind, type TaskState } from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { toTask } from "../../lib/coachMappers.js";
import { announceUnblocked } from "../../services/coach/actions.js";
import { stateAfterSent } from "../../services/coach/chain.js";
import { createTask, taskColumns, type TaskBody } from "../../services/coach/taskInput.js";
import { loadTasks } from "../../services/coach/taskStore.js";
import { syncTaskReminders } from "../../services/coach/reminders.js";

export const taskRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

// ── GET / — what's on the plate ──────────────────────────────────────────

taskRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const state = c.req.query("state");
  const projectId = c.req.query("projectId");
  if (state !== undefined && !TASK_STATES.includes(state as TaskState)) {
    return c.json({ error: "state must be open, waiting, done or dropped" }, 400);
  }

  const { tasks } = await loadTasks(userId);
  const shown = tasks
    .filter((t) => (state ? t.state === state : t.state === "open" || t.state === "waiting"))
    .filter((t) => !projectId || t.projectId === projectId)
    .sort((a, b) => {
      // Dated first, soonest first; undated keep their chain order.
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
  return c.json({ tasks: shown });
});

// ── POST / — a task the user makes themselves ────────────────────────────

taskRoutes.post("/", async (c) => {
  const result = await createTask(c.get("userId"), await c.req.json<TaskBody>());
  return c.json(result.body, result.status);
});

// ── PATCH /:id — change, complete, drop or reopen ────────────────────────

taskRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<TaskBody>();

  const { tasks } = await loadTasks(userId);
  const task = tasks.find((t) => t.id === id);
  if (!task) return c.json({ error: "task not found" }, 404);

  const parsed = taskColumns(body, task.kind, task.dueDate);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const values = parsed.values;

  if (body.state !== undefined) {
    if (!TASK_STATES.includes(body.state as TaskState)) {
      return c.json({ error: "state must be open, done or dropped" }, 400);
    }
    // Waiting means "sent, ball is with them": only /sent sets it.
    if (body.state === "waiting") return c.json({ error: "use sent to mark a task waiting" }, 400);
    if (body.state === "done" && task.blocked) return c.json({ error: "task is blocked" }, 409);
    values.state = body.state;
    values.done_at = body.state === "done" ? new Date().toISOString() : null;
  }
  if (Object.keys(values).length === 0) return c.json({ error: "nothing to update" }, 400);

  const { data, error } = await supabase
    .from("coach_tasks")
    .update(values)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error || !data) return c.json({ error: "Failed to update task" }, 500);
  // Reminders follow the date, the time and whether the task is still live.
  if ("due_date" in values || "due_time" in values || "state" in values) {
    await syncTaskReminders(userId, [id]);
  }
  // Finishing or dropping a task frees whatever was waiting on it.
  if (values.state === "done" || values.state === "dropped") {
    await announceUnblocked(userId, id, tasks);
  }
  return c.json({ task: toTask(data as Row, body.state === undefined ? task.blocked : false) });
});

// ── POST /:id/sent — the message went out ────────────────────────────────

taskRoutes.post("/:id/sent", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data: row } = await supabase
    .from("coach_tasks")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return c.json({ error: "task not found" }, 404);

  const next = stateAfterSent((row as Row).kind as TaskKind);
  if (!next) return c.json({ error: "only tell and ask tasks can be sent" }, 400);

  const { data, error } = await supabase
    .from("coach_tasks")
    .update({ state: next, done_at: next === "done" ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error || !data) return c.json({ error: "Failed to update task" }, 500);
  await syncTaskReminders(userId, [id]);
  if (next === "done") await announceUnblocked(userId, id, (await loadTasks(userId)).tasks);
  return c.json({ task: toTask(data as Row, false) });
});
