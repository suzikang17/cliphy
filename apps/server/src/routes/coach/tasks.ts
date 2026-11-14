import { Hono } from "hono";
import {
  TASK_KINDS,
  TASK_STATES,
  type ChecklistItem,
  type CoachTask,
  type TaskKind,
  type TaskState,
} from "@cliphy/shared";
import type { AppEnv } from "../../env.js";
import { supabase } from "../../lib/supabase.js";
import { toTask } from "../../lib/coachMappers.js";
import { isBlocked, stateAfterSent } from "../../services/coach/chain.js";
import { syncTaskReminders } from "../../services/coach/reminders.js";

export const taskRoutes = new Hono<AppEnv>();

type Row = Record<string, unknown>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** All of the user's tasks. Blocked depends on other tasks, so it needs the whole set. */
async function allTasks(userId: string): Promise<{ rows: Row[]; tasks: CoachTask[] }> {
  const { data } = await supabase.from("coach_tasks").select("*").eq("user_id", userId);
  const rows = (data as Row[]) ?? [];
  const byId = new Map(rows.map((r) => [r.id as string, { state: r.state as TaskState }]));
  const tasks = rows.map((r) =>
    toTask(r, isBlocked({ afterTaskId: (r.after_task_id as string) ?? null }, byId)),
  );
  return { rows, tasks };
}

function parseChecklist(raw: unknown): ChecklistItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: ChecklistItem[] = [];
  for (const item of raw as Row[]) {
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    if (!text) return null;
    items.push({ text, done: item.done === true });
  }
  return items;
}

interface TaskBody {
  kind?: unknown;
  title?: unknown;
  state?: unknown;
  projectId?: unknown;
  withPersonId?: unknown;
  dueDate?: unknown;
  dueTime?: unknown;
  place?: unknown;
  checklist?: unknown;
  kit?: unknown;
}

/**
 * Validate the fields shared by create and update into column values.
 * `kind` is the task's kind (from the body on create, from the row on update)
 * and `currentDate` the date it has now, so a time can be checked against it.
 */
function taskColumns(
  body: TaskBody,
  kind: TaskKind,
  currentDate: string | null,
): { error: string } | { values: Row } {
  const values: Row = {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return { error: "title is required" };
    values.title = title;
  }

  let date = currentDate;
  if (body.dueDate !== undefined) {
    if (body.dueDate === null) {
      date = null;
      values.due_date = null;
      values.due_time = null; // a time means nothing without its date
    } else if (typeof body.dueDate === "string" && DATE.test(body.dueDate)) {
      date = body.dueDate;
      values.due_date = date;
    } else {
      return { error: "dueDate must be YYYY-MM-DD" };
    }
  }
  if (body.dueTime !== undefined && body.dueTime !== null) {
    if (typeof body.dueTime !== "string" || !TIME.test(body.dueTime)) {
      return { error: "dueTime must be HH:MM" };
    }
    if (!date) return { error: "dueTime needs a dueDate" };
    values.due_time = body.dueTime;
  } else if (body.dueTime === null) {
    values.due_time = null;
  }

  if (body.place !== undefined || body.checklist !== undefined) {
    if (kind !== "get") return { error: "place and checklist are for get tasks" };
    if (body.place !== undefined) {
      values.place = typeof body.place === "string" && body.place.trim() ? body.place.trim() : null;
    }
    if (body.checklist !== undefined) {
      const checklist = parseChecklist(body.checklist);
      if (!checklist) return { error: "checklist must be a list of { text, done }" };
      values.checklist = checklist;
    }
  }

  if (body.kit !== undefined) {
    if (typeof body.kit !== "object" || body.kit === null || Array.isArray(body.kit)) {
      return { error: "kit must be an object" };
    }
    values.kit = body.kit;
  }
  return { values };
}

/** `id` if it names a row of `table` owned by the user, else null. */
async function ownId(table: string, id: unknown, userId: string): Promise<string | null> {
  if (typeof id !== "string") return null;
  const { data } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? id : null;
}

// ── GET / — what's on the plate ──────────────────────────────────────────

taskRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const state = c.req.query("state");
  const projectId = c.req.query("projectId");
  if (state !== undefined && !TASK_STATES.includes(state as TaskState)) {
    return c.json({ error: "state must be open, waiting, done or dropped" }, 400);
  }

  const { tasks } = await allTasks(userId);
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
  const userId = c.get("userId");
  const body = await c.req.json<TaskBody>();

  if (!TASK_KINDS.includes(body.kind as TaskKind)) {
    return c.json({ error: "kind must be do, tell, ask or get" }, 400);
  }
  const kind = body.kind as TaskKind;
  if (body.title === undefined) return c.json({ error: "title is required" }, 400);
  const parsed = taskColumns(body, kind, null);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  let projectId: string | null = null;
  if (body.projectId !== undefined && body.projectId !== null) {
    projectId = await ownId("coach_projects", body.projectId, userId);
    if (!projectId) return c.json({ error: "project not found" }, 400);
  }
  let withPersonId: string | null = null;
  if (body.withPersonId !== undefined && body.withPersonId !== null) {
    withPersonId = await ownId("coach_people", body.withPersonId, userId);
    if (!withPersonId) return c.json({ error: "person not found" }, 400);
  }

  const { data, error } = await supabase
    .from("coach_tasks")
    .insert({
      user_id: userId,
      request_id: null,
      project_id: projectId,
      with_person_id: withPersonId,
      kind,
      ...parsed.values,
    })
    .select("*")
    .single();
  if (error || !data) return c.json({ error: "Failed to create task" }, 500);
  await syncTaskReminders(userId, [(data as Row).id as string]);
  return c.json({ task: toTask(data as Row, false) }, 201);
});

// ── PATCH /:id — change, complete, drop or reopen ────────────────────────

taskRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<TaskBody>();

  const { tasks } = await allTasks(userId);
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
  return c.json({ task: toTask(data as Row, false) });
});
